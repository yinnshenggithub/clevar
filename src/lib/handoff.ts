import "server-only";
import { withTenant } from "./tenant";

// Human takeover (design §3.5). The load-bearing move is clearing
// assignedAgentId: every reply orchestrator skips AI replies when it's null,
// so a handoff mechanically silences the bot until a human re-assigns it.

export type HandoffReason =
  | "requested_human"
  | "frustrated"
  | "complaint"
  | "sensitive_topic"
  | "cannot_answer"
  | "off_hours"
  | "other";

const REASON_LABEL: Record<HandoffReason, string> = {
  requested_human: "Customer asked for a human",
  frustrated: "Customer seems frustrated",
  complaint: "Complaint / refund",
  sensitive_topic: "Sensitive topic (billing/legal/security)",
  cannot_answer: "Agent couldn't answer from the knowledge base",
  off_hours: "Outside business hours",
  other: "Escalated by the agent",
};

export function defaultHandoffMessage(): string {
  return "Thanks for your patience — I'm bringing in a teammate to help. They'll reply here shortly.";
}

/**
 * Executes the takeover: assign the configured teammate, reopen the
 * conversation, silence the bot, leave a private note for the team, and emit
 * the `conversation_handoff` workflow event. Returns the customer-facing
 * takeover line (the caller delivers it on its channel).
 */
export async function performHandoff(opts: {
  workspaceId: string;
  conversationId: string;
  agent: { id: string; name: string; handoffUserId: string | null; handoffMessage?: string | null };
  reason: HandoffReason;
  summary?: string;
}): Promise<string> {
  const { workspaceId, conversationId, agent, reason, summary } = opts;

  const convo = await withTenant(workspaceId, async (tx) => {
    const c = await tx.conversation.findFirst({
      where: { id: conversationId },
      select: { channelType: true, channelId: true, customerPhone: true },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        assignedAgentId: null,
        assignedUserId: agent.handoffUserId ?? undefined,
        status: "OPEN",
      },
    });
    await tx.message.create({
      data: {
        workspaceId,
        conversationId,
        direction: "OUTBOUND",
        private: true,
        type: "text",
        body: `🤝 Handed off by AI agent "${agent.name}" — ${REASON_LABEL[reason] ?? reason}.${
          summary ? `\nContext: ${summary.slice(0, 300)}` : ""
        }`,
      },
    });
    return c;
  });

  // Dynamic import breaks the module cycle (workflow actions ← agent-reply ← handoff).
  try {
    const { runWorkflows } = await import("./workflow");
    const kind = convo?.channelType === "whatsapp" || convo?.channelType === "whatsapp_web" ? convo.channelType : null;
    await runWorkflows(workspaceId, "conversation_handoff", {
      conversationId,
      reason,
      summary: summary ?? "",
      customerPhone: convo?.customerPhone,
      ...(kind && convo?.channelId ? { channel: { kind, id: convo.channelId } } : {}),
    });
  } catch (e) {
    console.error("conversation_handoff workflow emit failed", e);
  }

  return agent.handoffMessage?.trim() || defaultHandoffMessage();
}
