import "server-only";
import { generateText, type CoreMessage } from "ai";
import { withTenant } from "./tenant";
import { prisma } from "./prisma";
import { resolveModel } from "./ai";
import { getCredits, creditsForTokens, debitCredits } from "./credits";
import { sendWhatsAppText } from "./whatsapp";
import { sendGatewayText, phoneToChatId } from "./wa-web";
import { sendMetaMessage } from "./meta";
import { retrievePassages } from "./knowledge";
import { styleMaxTokens } from "./agent-presets";
import {
  compileSystemPrompt,
  compileStaticBlock,
  compileTurnMessage,
  stripCitations,
  UNDERSTOOD,
  type PromptConfig,
  type RetrievedPassage,
} from "./agent-prompt";
import { screenInbound, screenOutbound, validateCitations } from "./agent-guard";
import { buildActionTools, type AgentActions } from "./agent-actions";

/* eslint-disable @typescript-eslint/no-explicit-any */

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asObjectArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : [];
}

export function toPromptConfig(agent: any): PromptConfig {
  return {
    name: agent.name,
    mode: agent.mode ?? "support",
    tone: agent.tone ?? "friendly",
    responseStyle: agent.responseStyle ?? "balanced",
    objectives: agent.objectives ?? "",
    constraints: agent.constraints ?? "",
    greeting: agent.greeting ?? "",
    instructions: agent.instructions ?? "",
    handoffEnabled: agent.handoffEnabled ?? true,
    dos: asStringArray(agent.dos),
    donts: asStringArray(agent.donts),
    playbook: asObjectArray(agent.playbook),
    examples: asObjectArray(agent.examples),
    grounding: agent.grounding ?? "strict",
    refusalLine: agent.refusalLine ?? null,
    languagePolicy: agent.languagePolicy ?? "mirror",
  };
}

function asActions(value: unknown): AgentActions {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AgentActions) : {};
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** "Don't know" delivery when a reply fails validation — honest, never a guess. */
function fallbackReply(cfg: PromptConfig): string {
  return cfg.handoffEnabled
    ? "I don't have that information on hand — let me bring in a teammate who can help."
    : "I don't have that information on hand right now.";
}

// ── CRM personalization (§3.4a) ────────────────────────────────────────────────

const PROFILE_FIELDS = ["name", "company", "email", "phone", "tags", "openDeals"] as const;

/** Builds the allowlisted profile object; null when personalization is off or no contact. */
async function loadProfile(
  tx: any,
  contactId: string | null | undefined,
  fields: string[],
): Promise<Record<string, unknown> | null> {
  const allow = fields.filter((f) => (PROFILE_FIELDS as readonly string[]).includes(f));
  if (!allow.length || !contactId) return null;
  const contact = await tx.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: { company: { select: { name: true } } },
  });
  if (!contact) return null;

  const profile: Record<string, unknown> = {};
  if (allow.includes("name")) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
    if (name) profile.name = name;
  }
  if (allow.includes("company") && contact.company?.name) profile.company = contact.company.name;
  if (allow.includes("email") && contact.email) profile.email = contact.email;
  if (allow.includes("phone") && contact.phone) profile.phone = contact.phone;
  if (allow.includes("tags") && contact.tags?.length) profile.tags = contact.tags.slice(0, 10);
  if (allow.includes("openDeals")) {
    const links = await tx.dealContact.findMany({
      where: { contactId },
      include: { deal: { select: { title: true, status: true, stage: { select: { name: true } } } } },
      take: 10,
    });
    const open = links
      .map((l: any) => l.deal)
      .filter((d: any) => d && d.status === "OPEN")
      .slice(0, 5)
      .map((d: any) => ({ title: d.title, stage: d.stage?.name ?? "" }));
    if (open.length) profile.openDeals = open;
  }
  return Object.keys(profile).length ? profile : null;
}

/** Loads everything a reply turn needs: agent, recent messages, CRM profile, labels, teammates. */
async function loadTurn(workspaceId: string, conversationId: string, agentId: string) {
  const [tenant, members] = await Promise.all([
    withTenant(workspaceId, async (tx) => {
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      const convo = await tx.conversation.findFirst({ where: { id: conversationId }, select: { contactId: true } });
      const msgs = await tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 20 });
      const labels = await tx.label.findMany({ select: { id: true, name: true } });
      const profile = agent
        ? await loadProfile(tx, convo?.contactId, asStringArray((agent as any).profileFields))
        : null;
      // Agent-level fact (not per-query): drives the grounding-contract variant.
      const docCount = agent ? await tx.agentDocument.count({ where: { agentId } }) : 0;
      return { agent, convo, msgs, labels, profile, hasKnowledge: docCount > 0 };
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);
  return { ...tenant, members: members.map((m) => ({ id: m.user.id, name: m.user.fullName })) };
}

// ── Prompt assembly ────────────────────────────────────────────────────────────

export interface TurnPlan {
  system: string;
  messages: CoreMessage[];
  temperature: number;
  maxTokens: number;
  passageCount: number;
  cfg: PromptConfig;
}

/**
 * Doc-backed message assembly (design §4): system = persona only; static block
 * (instructions/guardrails/playbook/examples/untrusted policy/grounding) as
 * the prompt-cached first user turn + seeded "Understood."; conversation
 * history; then the per-turn message with CRM profile + retrieved passages +
 * the JSON-encoded customer message, question last.
 */
export function prepareTurn(opts: {
  agent: any;
  history: CoreMessage[];
  customerText: string;
  passages: RetrievedPassage[];
  profile?: Record<string, unknown> | null;
  /** Agent has ANY knowledge documents — NOT whether this query matched some. */
  hasKnowledge?: boolean;
}): TurnPlan {
  const cfg = toPromptConfig(opts.agent);
  const staticBlock = compileStaticBlock(cfg, opts.hasKnowledge ?? opts.passages.length > 0);
  const turn = compileTurnMessage({
    profile: opts.profile,
    passages: opts.passages,
    customerText: opts.customerText,
  });

  const messages: CoreMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: staticBlock,
          // Stable per agent config — cache across turns and conversations.
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
      ],
    },
    { role: "assistant", content: UNDERSTOOD },
    ...opts.history,
    { role: "user", content: turn },
  ];

  return {
    system: compileSystemPrompt(cfg),
    messages,
    temperature: opts.agent.temperature ?? 0.5,
    maxTokens: styleMaxTokens(cfg.responseStyle),
    passageCount: opts.passages.length,
    cfg,
  };
}

/** Runs one agent turn with action tools wired in. Tools mutate live (dryRun: false). */
async function generateTurn(opts: {
  workspaceId: string;
  conversationId: string;
  agent: any;
  coreMessages: CoreMessage[];
  contactId?: string | null;
  profile?: Record<string, unknown> | null;
  hasKnowledge: boolean;
  members: { id: string; name: string }[];
  labels: { id: string; name: string }[];
}) {
  const { workspaceId, conversationId, agent, coreMessages, contactId, profile, hasKnowledge, members, labels } = opts;

  // The trailing inbound message is the current customer turn — it gets wrapped;
  // earlier history stays as plain conversation.
  const history = [...coreMessages];
  let customerText = "";
  if (history.length && history[history.length - 1].role === "user") {
    const last = history.pop()!;
    customerText = typeof last.content === "string" ? last.content : "";
  }
  // Nothing to respond to (e.g. the trailing message was outbound) — don't
  // generate against a blank question.
  if (!customerText.trim()) return { text: "", usage: undefined };

  // Suspicious inbound still gets a (grounded, guarded) reply — but no tools.
  const inboundScreen = screenInbound(customerText);
  if (inboundScreen.suspicious) {
    console.warn("agent inbound screen", { conversationId, reason: inboundScreen.reason });
  }

  const passages = await retrievePassages(workspaceId, agent.id, customerText);
  const plan = prepareTurn({ agent, history, customerText, passages, profile, hasKnowledge });

  const { tools } = buildActionTools({
    workspaceId,
    conversationId,
    contactId,
    actions: asActions(agent.actions),
    members,
    labels,
    dryRun: false,
  });
  const hasTools = Object.keys(tools).length > 0 && !inboundScreen.suspicious;

  const result = await generateText({
    model: resolveModel(agent.model),
    system: plan.system,
    messages: plan.messages,
    temperature: plan.temperature,
    maxTokens: plan.maxTokens,
    ...(hasTools ? { tools, maxSteps: 5 } : {}),
  });

  // Post-generation guards: leak screen, then citation validation (strict
  // grounding + passages present). Failures deliver an honest "don't know"
  // instead of the generated text.
  let text = result.text;
  if (text.trim()) {
    const out = screenOutbound(text);
    if (out.blocked) {
      console.warn("agent outbound screen blocked reply", { conversationId, reason: out.reason });
      text = fallbackReply(plan.cfg);
    } else if (plan.cfg.grounding === "strict" && plan.passageCount > 0) {
      const cites = validateCitations(text, plan.passageCount);
      if (!cites.ok) {
        console.warn("agent citation check failed", { conversationId, invalid: cites.invalid });
        text = fallbackReply(plan.cfg);
      } else if (!cites.cited.length && text.length > 200) {
        // Deliverable (may be a greeting/clarification), but a long uncited
        // strict-mode answer is a hallucination signal worth tracking.
        console.warn("agent uncited strict reply", { conversationId, length: text.length });
      }
    }
    // Channels render plain text — citation markers are internal bookkeeping.
    text = stripCitations(text);
  }

  return { text, usage: result.usage };
}

// ── Reply turn (shared across channels) ────────────────────────────────────────

/** Max AI replies per conversation per hour — runaway-loop / cost backstop. */
const REPLIES_PER_HOUR_CAP = 20;

/**
 * Shared reply turn: load context, generate, deliver via the channel-specific
 * callback, persist the OUTBOUND message, debit credits. `deliver` returns the
 * provider message id (or undefined for persist-only channels like web chat).
 */
async function runReplyTurn(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  deliver: (text: string) => Promise<string | undefined>;
  clearWaiting: boolean;
}): Promise<void> {
  const { workspaceId, conversationId, agentId, deliver, clearWaiting } = opts;
  if (!hasLlmKey()) return;

  const data = await loadTurn(workspaceId, conversationId, agentId);
  if (!data.agent) return;

  const credits = await getCredits(workspaceId);
  if (credits.remaining <= 0) return;

  // Count only AI-authored customer replies — not human replies or private notes.
  const recentReplies = await withTenant(workspaceId, (tx) =>
    tx.message.count({
      where: {
        conversationId,
        direction: "OUTBOUND",
        private: false,
        authorUserId: null,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    }),
  );
  if (recentReplies >= REPLIES_PER_HOUR_CAP) return;

  const coreMessages: CoreMessage[] = data.msgs
    .filter((m) => !m.private)
    .map((m) => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.body }));

  const { text, usage } = await generateTurn({
    workspaceId,
    conversationId,
    agent: data.agent,
    coreMessages,
    contactId: data.convo?.contactId,
    profile: data.profile,
    hasKnowledge: data.hasKnowledge,
    members: data.members,
    labels: data.labels,
  });

  if (text.trim()) {
    const externalId = await deliver(text);
    await withTenant(workspaceId, async (tx) => {
      await tx.message.create({
        data: { workspaceId, conversationId, direction: "OUTBOUND", body: text, type: "text", waMessageId: externalId ?? null },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), ...(clearWaiting ? { waitingSince: null } : {}) },
      });
    });
  }

  await debitCredits(workspaceId, creditsForTokens(usage?.totalTokens ?? 0), {
    agentId,
    conversationId,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
  });
}

/** Generates an AI reply for a conversation and sends it over WhatsApp Cloud API, debiting credits. */
export async function runAgentReply(opts: {
  workspaceId: string;
  phoneNumberId: string;
  accessToken: string;
  conversationId: string;
  phone: string;
  agentId: string;
}): Promise<void> {
  const { workspaceId, phoneNumberId, accessToken, conversationId, phone, agentId } = opts;
  await runReplyTurn({
    workspaceId,
    conversationId,
    agentId,
    deliver: (text) => sendWhatsAppText(phoneNumberId, accessToken, phone, text),
    clearWaiting: false,
  });
}

/** AI reply for a web-linked WhatsApp conversation — sends through the messaging gateway. */
export async function runWaWebAgentReply(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  sessionName: string;
  phone: string;
}): Promise<void> {
  const { workspaceId, conversationId, agentId, sessionName, phone } = opts;
  await runReplyTurn({
    workspaceId,
    conversationId,
    agentId,
    deliver: (text) => sendGatewayText(sessionName, phoneToChatId(phone), text),
    clearWaiting: true,
  });
}

/** AI reply for a Messenger / Instagram conversation — generates and sends via the Meta page token. */
export async function runMetaAgentReply(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  pageAccessToken: string;
  recipientId: string;
}): Promise<void> {
  const { workspaceId, conversationId, agentId, pageAccessToken, recipientId } = opts;
  await runReplyTurn({
    workspaceId,
    conversationId,
    agentId,
    deliver: (text) => sendMetaMessage(pageAccessToken, recipientId, text),
    clearWaiting: true,
  });
}

/** AI reply for a web-chat conversation — persists OUTBOUND (visitor polls); no external send. */
export async function runWebchatAgentReply(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
}): Promise<void> {
  const { workspaceId, conversationId, agentId } = opts;
  await runReplyTurn({
    workspaceId,
    conversationId,
    agentId,
    deliver: async () => undefined,
    clearWaiting: true,
  });
}
