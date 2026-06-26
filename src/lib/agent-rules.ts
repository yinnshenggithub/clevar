import "server-only";
import { withTenant } from "./tenant";

export interface AgentRule {
  label?: string;
  trigger: "keyword" | "asks_human";
  keywords?: string; // comma-separated, for trigger=keyword
  action: "handoff" | "note";
  note?: string;
}

const HUMAN_NOUN = /\b(human|person|agent|representative|rep|teammate|staff|somebody|someone)\b/i;
const WANT_VERB = /\b(speak|talk|chat|connect|transfer|escalate|reach|contact|call)\b/i;

function matches(rule: AgentRule, text: string): boolean {
  if (!text) return false;
  if (rule.trigger === "asks_human") {
    return (HUMAN_NOUN.test(text) && WANT_VERB.test(text)) || /\b(real|live)\s+(person|human|agent)\b/i.test(text);
  }
  const t = text.toLowerCase();
  const kws = (rule.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return kws.some((k) => t.includes(k));
}

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
    if (!matches(rule, messageText)) continue;
    const note = rule.note?.trim() || `Auto-handoff (${rule.label || rule.trigger}) — customer message matched a rule.`;

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
