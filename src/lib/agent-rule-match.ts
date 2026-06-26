// Pure if-then rule matching — no DB, no server-only imports, so it's safe to
// run on the client (live rule preview in the tester) AND on the server
// (evaluateAgentRules). Keep this the single source of truth for match logic.

export interface AgentRule {
  label?: string;
  trigger: "keyword" | "asks_human";
  keywords?: string; // comma-separated, for trigger=keyword
  action: "handoff" | "note";
  note?: string;
}

const HUMAN_NOUN = /\b(human|person|agent|representative|rep|teammate|staff|somebody|someone)\b/i;
const WANT_VERB = /\b(speak|talk|chat|connect|transfer|escalate|reach|contact|call)\b/i;

/** True if a single rule matches the message text. */
export function matchRule(rule: AgentRule, text: string): boolean {
  if (!text) return false;
  if (rule.trigger === "asks_human") {
    return (HUMAN_NOUN.test(text) && WANT_VERB.test(text)) || /\b(real|live)\s+(person|human|agent)\b/i.test(text);
  }
  const t = text.toLowerCase();
  const kws = (rule.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return kws.some((k) => t.includes(k));
}

/** First rule that matches the text, or null. Order is significant (first wins). */
export function firstMatchingRule(rules: AgentRule[], text: string): AgentRule | null {
  for (const rule of rules) {
    if (matchRule(rule, text)) return rule;
  }
  return null;
}

/** Default internal-note text for a matched rule (mirrors the server evaluator). */
export function ruleNote(rule: AgentRule): string {
  return rule.note?.trim() || `Auto-handoff (${rule.label || rule.trigger}) — customer message matched a rule.`;
}
