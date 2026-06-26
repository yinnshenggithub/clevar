import "server-only";
import type { Workflow } from "@prisma/client";
import { withTenant } from "./tenant";
import { sendWhatsAppText } from "./whatsapp";

export type TriggerType =
  | "message_received"
  | "contact_created"
  | "deal_created"
  | "deal_stage_changed";

export interface WorkflowContext {
  // conversation triggers
  conversationId?: string;
  messageText?: string;
  customerPhone?: string;
  channel?: { phoneNumberId: string; accessToken: string };
  // crm triggers
  contactId?: string;
  dealId?: string;
  recordName?: string;
  stageName?: string;
}

function fieldValue(field: string | null, ctx: WorkflowContext): string | undefined {
  switch (field) {
    case "message":
      return ctx.messageText;
    case "phone":
      return ctx.customerPhone;
    case "stage":
      return ctx.stageName;
    case "name":
      return ctx.recordName;
    default:
      return undefined;
  }
}

function matchesCondition(wf: Workflow, ctx: WorkflowContext): boolean {
  if (!wf.conditionField || !wf.conditionValue) return true;
  const v = (fieldValue(wf.conditionField, ctx) ?? "").toLowerCase();
  const target = wf.conditionValue.toLowerCase();
  return wf.conditionOp === "equals" ? v === target : v.includes(target);
}

/**
 * Runs all enabled workflows for a trigger. Returns true if any action already
 * sent a customer reply (so the caller can avoid a duplicate AI auto-reply).
 */
export async function runWorkflows(
  workspaceId: string,
  triggerType: TriggerType,
  ctx: WorkflowContext,
): Promise<{ repliedExternally: boolean }> {
  let workflows: Workflow[] = [];
  try {
    workflows = await withTenant(workspaceId, (tx) =>
      tx.workflow.findMany({ where: { triggerType, enabled: true } }),
    );
  } catch (e) {
    console.error("runWorkflows load failed", e);
    return { repliedExternally: false };
  }

  let repliedExternally = false;
  for (const wf of workflows) {
    try {
      if (!matchesCondition(wf, ctx)) continue;
      for (const step of resolveSteps(wf)) {
        const replied = await runStep(workspaceId, step, ctx);
        repliedExternally = repliedExternally || replied;
      }
    } catch (e) {
      console.error("workflow action failed", wf.id, e);
    }
  }
  return { repliedExternally };
}

interface Step {
  type: string;
  agentId: string | null;
  text: string | null;
}

/** Uses the canvas `steps` array if present, else the legacy single-action columns. */
function resolveSteps(wf: Workflow): Step[] {
  const raw = wf.steps;
  if (Array.isArray(raw) && raw.length > 0) {
    return (raw as unknown[]).map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        type: String(o.type ?? ""),
        agentId: o.agentId ? String(o.agentId) : null,
        text: o.text ? String(o.text) : null,
      };
    });
  }
  return [{ type: wf.actionType, agentId: wf.actionAgentId, text: wf.actionText }];
}

/** Executes one workflow step. Returns true if it sent a reply to the customer. */
async function runStep(workspaceId: string, step: Step, ctx: WorkflowContext): Promise<boolean> {
  if (step.type === "assign_agent") {
    // Only assign here; the AI reply is performed once by the caller (webhook).
    if (ctx.conversationId && step.agentId) {
      await withTenant(workspaceId, (tx) =>
        tx.conversation.update({ where: { id: ctx.conversationId! }, data: { assignedAgentId: step.agentId } }),
      );
    }
    return false;
  }

  if (step.type === "send_reply") {
    if (ctx.conversationId && ctx.channel && ctx.customerPhone && step.text) {
      const waId = await sendWhatsAppText(ctx.channel.phoneNumberId, ctx.channel.accessToken, ctx.customerPhone, step.text);
      await withTenant(workspaceId, async (tx) => {
        await tx.message.create({
          data: { workspaceId, conversationId: ctx.conversationId!, direction: "OUTBOUND", body: step.text!, waMessageId: waId },
        });
        await tx.conversation.update({ where: { id: ctx.conversationId! }, data: { lastMessageAt: new Date() } });
      });
      return true;
    }
    return false;
  }

  if (step.type === "add_note" && step.text) {
    if (ctx.contactId) {
      await withTenant(workspaceId, (tx) =>
        tx.note.create({ data: { workspaceId, parentType: "CONTACT", parentId: ctx.contactId!, body: step.text! } }),
      );
    } else if (ctx.dealId) {
      await withTenant(workspaceId, (tx) =>
        tx.note.create({ data: { workspaceId, parentType: "DEAL", parentId: ctx.dealId!, body: step.text! } }),
      );
    }
  }
  return false;
}
