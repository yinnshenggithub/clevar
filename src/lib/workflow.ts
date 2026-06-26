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
      const replied = await runAction(workspaceId, wf, ctx);
      repliedExternally = repliedExternally || replied;
    } catch (e) {
      console.error("workflow action failed", wf.id, e);
    }
  }
  return { repliedExternally };
}

/** Executes one workflow action. Returns true if it sent a reply to the customer. */
async function runAction(workspaceId: string, wf: Workflow, ctx: WorkflowContext): Promise<boolean> {
  if (wf.actionType === "assign_agent") {
    // Only assign here; the AI reply is performed once by the caller (webhook).
    if (ctx.conversationId && wf.actionAgentId) {
      await withTenant(workspaceId, (tx) =>
        tx.conversation.update({ where: { id: ctx.conversationId! }, data: { assignedAgentId: wf.actionAgentId } }),
      );
    }
    return false;
  }

  if (wf.actionType === "send_reply") {
    if (ctx.conversationId && ctx.channel && ctx.customerPhone && wf.actionText) {
      const waId = await sendWhatsAppText(
        ctx.channel.phoneNumberId,
        ctx.channel.accessToken,
        ctx.customerPhone,
        wf.actionText,
      );
      await withTenant(workspaceId, async (tx) => {
        await tx.message.create({
          data: {
            workspaceId,
            conversationId: ctx.conversationId!,
            direction: "OUTBOUND",
            body: wf.actionText!,
            waMessageId: waId,
          },
        });
        await tx.conversation.update({ where: { id: ctx.conversationId! }, data: { lastMessageAt: new Date() } });
      });
      return true;
    }
    return false;
  }

  if (wf.actionType === "add_note" && wf.actionText) {
    if (ctx.contactId) {
      await withTenant(workspaceId, (tx) =>
        tx.note.create({ data: { workspaceId, parentType: "CONTACT", parentId: ctx.contactId!, body: wf.actionText! } }),
      );
    } else if (ctx.dealId) {
      await withTenant(workspaceId, (tx) =>
        tx.note.create({ data: { workspaceId, parentType: "DEAL", parentId: ctx.dealId!, body: wf.actionText! } }),
      );
    }
  }
  return false;
}
