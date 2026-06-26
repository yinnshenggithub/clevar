import "server-only";
import { withTenant } from "./tenant";
import { matchRule, ruleNote, type AgentRule } from "./agent-rule-match";

export type { AgentRule } from "./agent-rule-match";

/**
 * Evaluates an agent's if-then rules against an inbound message. Keyword and
 * "asks for a human" triggers work WITHOUT an LLM (pure text match), so handoff,
 * internal notes, and routing function even when AI replies are disabled.
 * On handoff: marks the conversation PENDING, unassigns the AI, optionally
 * assigns a human, and drops an internal note (the human's "notification").
 */
export async function evaluateAgentRules(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  messageText: string;
}): Promise<{ handedOff: boolean }> {
  const { workspaceId, conversationId, agentId, messageText } = opts;
  if (!messageText?.trim()) return { handedOff: false };

  const agent = await withTenant(workspaceId, (tx) =>
    tx.aiAgent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { rules: true, handoffEnabled: true, handoffUserId: true },
    }),
  );
  if (!agent) return { handedOff: false };
  const rules = (Array.isArray(agent.rules) ? agent.rules : []) as unknown as AgentRule[];

  for (const rule of rules) {
    if (!matchRule(rule, messageText)) continue;
    const note = ruleNote(rule);

    if (rule.action === "handoff" && agent.handoffEnabled) {
      await withTenant(workspaceId, async (tx) => {
        await tx.message.create({
          data: { workspaceId, conversationId, direction: "OUTBOUND", private: true, type: "text", body: `🤝 ${note}` },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { status: "PENDING", assignedAgentId: null, ...(agent.handoffUserId ? { assignedUserId: agent.handoffUserId } : {}) },
        });
      });
      return { handedOff: true };
    }

    if (rule.action === "note") {
      await withTenant(workspaceId, (tx) =>
        tx.message.create({
          data: { workspaceId, conversationId, direction: "OUTBOUND", private: true, type: "text", body: `📝 ${note}` },
        }),
      );
    }
  }
  return { handedOff: false };
}
