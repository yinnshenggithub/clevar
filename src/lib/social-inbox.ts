import "server-only";
import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { logEventTx } from "./activity";
import type { LeadFields } from "./meta";

/** Find-or-create a conversation for a social channel and append an inbound message. */
export async function persistSocialInbound(opts: {
  workspaceId: string;
  channelType: string; // "messenger" | "instagram" | "tiktok"
  customerKey: string; // prefixed external id, e.g. "fb:123"
  name: string | null;
  body: string;
  autoReplyAgentId?: string | null;
}): Promise<{ conversationId: string; assignedAgentId: string | null }> {
  const { workspaceId, channelType, customerKey, name, body, autoReplyAgentId } = opts;
  return withTenant(workspaceId, async (tx) => {
    let convo = await tx.conversation.findFirst({
      where: { customerPhone: customerKey, channelType },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId,
          channelType,
          customerPhone: customerKey,
          customerName: name,
          assignedAgentId: autoReplyAgentId ?? null,
          waitingSince: new Date(),
        },
      });
    }
    await tx.message.create({
      data: { workspaceId, conversationId: convo.id, direction: "INBOUND", body, type: "text" },
    });
    await tx.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), status: "OPEN", snoozedUntil: null, waitingSince: new Date(), customerName: name ?? convo.customerName },
    });
    return { conversationId: convo.id, assignedAgentId: convo.assignedAgentId ?? autoReplyAgentId ?? null };
  });
}

/** Creates a CRM contact from a captured lead, with a note + activity event. */
export async function createLeadContact(
  workspaceId: string,
  lead: LeadFields,
  source: string,
  formId?: string | null,
): Promise<void> {
  const firstName = lead.firstName || (lead.fullName ? lead.fullName.split(" ")[0] : null) || null;
  const lastName =
    lead.lastName || (lead.fullName ? lead.fullName.split(" ").slice(1).join(" ") || null : null) || null;

  await withTenant(workspaceId, async (tx) => {
    let companyId: string | null = null;
    if (lead.companyName) {
      const company = await tx.company.create({ data: { workspaceId, name: lead.companyName } });
      companyId = company.id;
    }
    const contact = await tx.contact.create({
      data: {
        workspaceId,
        firstName,
        lastName,
        email: lead.email || null,
        phone: lead.phone || null,
        companyId,
        customFields: { source, formId: formId ?? null } as Prisma.InputJsonValue,
      },
    });
    const noteBody =
      `Lead captured from ${source}.\n` +
      Object.entries(lead.raw)
        .map(([k, v]) => `• ${k}: ${v}`)
        .join("\n");
    await tx.note.create({ data: { workspaceId, parentType: "CONTACT", parentId: contact.id, body: noteBody } });
    await logEventTx(tx, workspaceId, "CONTACT", contact.id, "created", `Lead from ${source}`, null);
  });
}
