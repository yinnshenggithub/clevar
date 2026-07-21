import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { withTenant } from "./tenant";
import type { AgentActions } from "./agent-action-defs";
import { loadPropertyCatalog, describeCatalog, writeProperty, readProperty } from "./agent-properties";

export { ACTION_DEFS, type AgentActions, type AgentActionConfig } from "./agent-action-defs";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Action keys that have a runtime tool implementation. */
const LIVE_KEYS = new Set(["close", "assign", "note", "label", "contactField"]);

function enabled(actions: AgentActions, key: string): boolean {
  return Boolean(actions?.[key]?.enabled) && LIVE_KEYS.has(key);
}
function guideline(actions: AgentActions, key: string): string {
  const g = actions?.[key]?.guideline?.trim();
  return g ? ` Guidelines from the operator: ${g}` : "";
}

/**
 * Builds the AI-SDK tool set for an agent's enabled actions. During a real
 * conversation (`dryRun: false`) the tools mutate the conversation/contact;
 * in the studio tester (`dryRun: true`) they only report what they *would* do,
 * so testing never touches live data. `taken` accumulates human-readable
 * summaries of everything the model invoked this turn.
 */
export async function buildActionTools(opts: {
  workspaceId: string;
  conversationId?: string;
  contactId?: string | null;
  actions: AgentActions;
  members: { id: string; name: string }[];
  labels: { id: string; name: string }[];
  dryRun: boolean;
  /** Force the property tools on even if the action toggle is off (intake needs them). */
  forceProperties?: boolean;
}): Promise<{ tools: Record<string, any>; taken: string[] }> {
  const { workspaceId, conversationId, contactId, actions, members, labels, dryRun, forceProperties } = opts;
  const taken: string[] = [];
  const tools: Record<string, any> = {};
  const live = !dryRun && Boolean(conversationId);

  if (enabled(actions, "close")) {
    tools.close_conversation = tool({
      description: `Mark this conversation as resolved when the customer's need is fully handled.${guideline(actions, "close")}`,
      parameters: z.object({ reason: z.string().optional().describe("Why it's being closed") }),
      execute: async ({ reason }) => {
        taken.push(`Closed conversation${reason ? ` (${reason})` : ""}`);
        if (!live) return "Simulated: conversation would be marked resolved.";
        await withTenant(workspaceId, (tx) =>
          tx.conversation.update({ where: { id: conversationId }, data: { status: "RESOLVED" } }),
        );
        return "Conversation marked resolved.";
      },
    });
  }

  if (enabled(actions, "assign")) {
    const roster = members.map((m) => m.name).join(", ") || "(no teammates available)";
    tools.assign_to_teammate = tool({
      description: `Hand this conversation to a human teammate; marks it pending and unassigns the AI. Available teammates: ${roster}.${guideline(actions, "assign")}`,
      parameters: z.object({
        teammate: z.string().describe("Name of the teammate to assign (must match the available list)"),
        reason: z.string().optional().describe("Short reason / context for the teammate"),
      }),
      execute: async ({ teammate, reason }) => {
        const match = members.find((m) => m.name.toLowerCase().includes(teammate.toLowerCase()));
        taken.push(`Assigned to ${match?.name ?? teammate}${reason ? ` — ${reason}` : ""}`);
        if (!live) return `Simulated: would assign to ${match?.name ?? teammate}.`;
        if (!match) return `No teammate named "${teammate}" found; left unassigned.`;
        await withTenant(workspaceId, async (tx) => {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { status: "PENDING", assignedUserId: match.id, assignedAgentId: null },
          });
          await tx.message.create({
            data: {
              workspaceId,
              conversationId: conversationId!,
              direction: "OUTBOUND",
              private: true,
              type: "text",
              body: `🤝 Assigned to ${match.name}${reason ? ` — ${reason}` : ""}`,
            },
          });
        });
        return `Assigned to ${match.name}.`;
      },
    });
  }

  if (enabled(actions, "note")) {
    tools.add_internal_note = tool({
      description: `Add a private internal note for the team (not sent to the customer).${guideline(actions, "note")}`,
      parameters: z.object({ note: z.string().describe("The internal note text") }),
      execute: async ({ note }) => {
        taken.push(`Internal note: ${note}`);
        if (!live) return "Simulated: internal note would be added.";
        await withTenant(workspaceId, (tx) =>
          tx.message.create({
            data: { workspaceId, conversationId: conversationId!, direction: "OUTBOUND", private: true, type: "text", body: `📝 ${note}` },
          }),
        );
        return "Internal note added.";
      },
    });
  }

  if (enabled(actions, "label")) {
    const names = labels.map((l) => l.name).join(", ") || "(no labels defined)";
    tools.apply_label = tool({
      description: `Apply a label to this conversation (used for tags and lifecycle stages). Available labels: ${names}.${guideline(actions, "label")}`,
      parameters: z.object({ label: z.string().describe("Name of the label to apply (must match an available label)") }),
      execute: async ({ label }) => {
        const match = labels.find((l) => l.name.toLowerCase() === label.toLowerCase()) ?? labels.find((l) => l.name.toLowerCase().includes(label.toLowerCase()));
        taken.push(`Applied label "${match?.name ?? label}"`);
        if (!live) return `Simulated: would apply label "${match?.name ?? label}".`;
        if (!match) return `No label named "${label}" found.`;
        try {
          await withTenant(workspaceId, (tx) =>
            tx.conversationLabel.create({ data: { workspaceId, conversationId: conversationId!, labelId: match.id } }),
          );
        } catch {
          return `Label "${match.name}" was already applied.`;
        }
        return `Applied label "${match.name}".`;
      },
    });
  }

  if (enabled(actions, "contactField") || forceProperties) {
    const catalog = await loadPropertyCatalog(workspaceId);
    const keys = catalog.map((e) => e.qualified);
    const schema = keys.length
      ? `Available properties (pass the exact string):\n${describeCatalog(catalog)}`
      : "No custom properties are configured yet.";
    const noContactNote = contactId ? "" : " (No contact is linked to this conversation, so writes are a no-op.)";

    tools.set_property = tool({
      description:
        `Store a value the customer provides into a CRM property, addressed as object.key ` +
        `(e.g. contact.firstName, contact.budget, project.location). Call this whenever the customer ` +
        `gives information that maps to one of these properties, per your instructions. Company and ` +
        `custom-object records are found or created automatically and linked to the contact.${noContactNote}` +
        `\n\n${schema}${guideline(actions, "contactField")}`,
      parameters: z.object({
        property: z.string().describe("The property to set, as object.key (must be one of the available properties)"),
        value: z.string().describe("The value to store"),
      }),
      execute: async ({ property, value }) => {
        taken.push(`Set ${property} = ${value}`);
        if (!live) return `Simulated: would set ${property} to "${value}".`;
        const res = await writeProperty(workspaceId, { catalog, contactId, property, value });
        return res.message;
      },
    });

    tools.get_property = tool({
      description:
        `Read the current value of a CRM property (object.key) for the linked contact and its related ` +
        `records — use it to check what you've already collected before asking again.\n\n${schema}`,
      parameters: z.object({
        property: z.string().describe("The property to read, as object.key"),
      }),
      execute: async ({ property }) => {
        if (!live) return `Simulated: would read ${property}.`;
        const res = await readProperty(workspaceId, { catalog, contactId, property });
        return res.message;
      },
    });
  }

  return { tools, taken };
}
