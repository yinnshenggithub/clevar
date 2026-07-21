import "server-only";
import { generateText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import { withTenant } from "./tenant";
import { prisma } from "./prisma";
import { performHandoff, defaultHandoffMessage, type HandoffReason } from "./handoff";
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
import { computeIntake, intakeDirective } from "./agent-intake";
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
    intakeFields: asStringArray(agent.intakeFields),
  };
}

function asActions(value: unknown): AgentActions {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AgentActions) : {};
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** Shared marker between our fallback replies and the can't-answer trigger counter. */
const DONT_KNOW_MARKER = "don't have that information";

/** "Don't know" delivery when a reply fails validation — honest, never a guess.
 *  Deliberately does NOT promise a teammate: no handoff happens here (the
 *  can't-answer trigger or the escalate tool does that when configured). */
function fallbackReply(cfg: PromptConfig): string {
  return cfg.handoffEnabled
    ? `I ${DONT_KNOW_MARKER} on hand right now — I've noted it for the team.`
    : `I ${DONT_KNOW_MARKER} on hand right now.`;
}

// ── Deterministic handoff triggers (pre-LLM, free) ─────────────────────────────

interface HandoffTriggerConfig {
  askHuman?: boolean;
  cantAnswer?: number;
  hours?: { enabled?: boolean; days?: number[]; start?: string; end?: string; tz?: string; message?: string };
}

function triggerConfig(agent: any): HandoffTriggerConfig {
  const t = agent?.handoffTriggers;
  return t && typeof t === "object" && !Array.isArray(t) ? (t as HandoffTriggerConfig) : {};
}

// Explicit ask-for-a-human intents (EN + BM + ZH) — deliberately conservative.
const ASK_HUMAN_RE =
  /\b(real (person|human)|live (agent|person)|human (agent|please|support)|speak (to|with) (a |an |some)?(person|human|agent|someone real|representative)|talk to (a |an )?(person|human|agent|manager|representative)|(customer service|support|sales) representative)\b|cakap dengan (orang|manusia|staf)|nak cakap dengan|人工客服|转人工|真人客服/i;

/** Minutes since midnight in the configured timezone; null when tz invalid. */
function localMinutes(tz: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    // Some ICU builds emit "24" for midnight under hour12:false.
    const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
    if (day < 0 || Number.isNaN(minutes)) return null;
    return { day, minutes };
  } catch {
    return null;
  }
}

function parseHm(v: string | undefined): number | null {
  const m = (v ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 1440 ? mins : null;
}

/**
 * Pre-LLM handoff checks: explicit ask-for-human, outside business hours, and
 * N consecutive "don't know" replies. Misconfigured pieces fail open (no
 * handoff) rather than silencing the agent.
 */
function checkDeterministicHandoff(opts: {
  trig: HandoffTriggerConfig;
  customerText: string;
  priorMessages: { direction: string; private: boolean; authorUserId: string | null; body: string }[];
}): { reason: HandoffReason; message?: string } | null {
  const { trig, customerText, priorMessages } = opts;

  if ((trig.askHuman ?? true) && ASK_HUMAN_RE.test(customerText)) {
    return { reason: "requested_human" };
  }

  const h = trig.hours;
  if (h?.enabled) {
    const now = localMinutes(h.tz || "UTC");
    const start = parseHm(h.start);
    const end = parseHm(h.end);
    const days = Array.isArray(h.days) && h.days.length ? h.days : null;
    if (now && start !== null && end !== null && days) {
      const inDay = days.includes(now.day);
      const inWindow =
        start <= end ? now.minutes >= start && now.minutes < end : now.minutes >= start || now.minutes < end;
      if (!inDay || !inWindow) return { reason: "off_hours", message: h.message?.trim() || undefined };
    }
  }

  const n = trig.cantAnswer;
  if (n && n >= 1) {
    let misses = 0;
    for (let i = priorMessages.length - 1; i >= 0; i--) {
      const m = priorMessages[i];
      if (m.direction === "INBOUND") continue; // customer retries don't reset the streak
      if (m.private) continue;
      if (m.authorUserId) break; // a human already replied
      if (m.body.includes(DONT_KNOW_MARKER)) {
        misses++;
        if (misses >= n) return { reason: "cannot_answer" };
      } else {
        break; // streak broken by a real answer
      }
    }
  }

  return null;
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
      const convo = await tx.conversation.findFirst({
        where: { id: conversationId },
        select: { contactId: true, assignedAgentId: true, assignedUserId: true },
      });
      const msgs = await tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 20 });
      const labels = await tx.label.findMany({ select: { id: true, name: true } });
      const profile = agent
        ? await loadProfile(tx, convo?.contactId, asStringArray((agent as any).profileFields))
        : null;
      // Agent-level fact (not per-query): drives the grounding-contract variant.
      // Only READY sources count — an agent whose sole source failed or is
      // mid-crawl must not be strict-bound to an empty knowledge block.
      const docCount = agent
        ? await tx.agentKnowledgeSource.count({ where: { agentId, source: { status: "ready" } } })
        : 0;
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
  /** Code-owned imperative appended last to the turn (e.g. intake collection mode). */
  directive?: string | null;
}): TurnPlan {
  const cfg = toPromptConfig(opts.agent);
  const staticBlock = compileStaticBlock(cfg, opts.hasKnowledge ?? opts.passages.length > 0);
  const turn = compileTurnMessage({
    profile: opts.profile,
    passages: opts.passages,
    customerText: opts.customerText,
    directive: opts.directive,
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
  if (!customerText.trim()) return { text: "", usage: undefined, handedOff: false };

  // Suspicious inbound still gets a (grounded, guarded) reply — but no tools.
  const inboundScreen = screenInbound(customerText);
  if (inboundScreen.suspicious) {
    console.warn("agent inbound screen", { conversationId, reason: inboundScreen.reason });
  }

  const passages = await retrievePassages(workspaceId, agent.id, customerText);
  const intakeFields = asStringArray(agent.intakeFields);
  const intake = await computeIntake(workspaceId, contactId, intakeFields);
  const plan = prepareTurn({
    agent,
    history,
    customerText,
    // Collection mode: withhold knowledge so the model can't answer product
    // questions, and inject the imperative to collect the next field.
    passages: intake.active ? [] : passages,
    profile,
    hasKnowledge,
    directive: intake.active ? intakeDirective(intake) : null,
  });

  const { tools } = await buildActionTools({
    workspaceId,
    conversationId,
    contactId,
    actions: asActions(agent.actions),
    members,
    labels,
    dryRun: false,
    // Intake needs set_property regardless of the action toggle.
    forceProperties: intakeFields.length > 0,
  });

  // Semantic escalation — the doc-backed client-side signal tool. Plain "Use
  // when…" phrasing on purpose: current models overtrigger on CRITICAL/MUST.
  let handedOff = false;
  if (agent.handoffEnabled) {
    (tools as Record<string, unknown>).escalate_to_human = tool({
      description:
        "Hand this conversation to a human teammate. Use when the customer is frustrated or upset, asks for a person, has a complaint, refund, legal, or account-security issue, or you cannot answer from the knowledge base after trying.",
      parameters: z.object({
        reason: z.enum(["frustrated", "requested_human", "complaint", "cannot_answer", "sensitive_topic", "other"]),
        summary: z.string().max(300).describe("One line of context for the teammate"),
      }),
      execute: async ({ reason, summary }) => {
        // Idempotent within the turn — maxSteps lets the model call twice.
        if (handedOff) {
          return { ok: true, instruction: "Already handed off. Tell the customer a teammate will take over, then stop." };
        }
        handedOff = true;
        await performHandoff({ workspaceId, conversationId, agent, reason, summary });
        return {
          ok: true,
          instruction:
            "A teammate has been notified and will take over. Tell the customer that in one short sentence, then stop.",
        };
      },
    });
  }
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
  // Tool fired but the model wrote nothing — still tell the customer.
  if (!text.trim() && handedOff) {
    text = (agent.handoffMessage as string | null)?.trim() || defaultHandoffMessage();
  }

  return { text, usage: result.usage, handedOff };
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
}): Promise<boolean> {
  const { workspaceId, conversationId, agentId, deliver, clearWaiting } = opts;
  if (!hasLlmKey()) return false;

  const data = await loadTurn(workspaceId, conversationId, agentId);
  if (!data.agent) return false;

  // Post-handoff signature: performHandoff clears assignedAgentId and (when
  // configured) assigns a teammate. A human-owned conversation must never get
  // a bot reply — this also covers the workflow "Reply with AI agent" path,
  // which deliberately ignores the channel's default agent assignment.
  if (data.convo && data.convo.assignedAgentId === null && data.convo.assignedUserId) return false;

  const deliverAndPersist = async (text: string): Promise<void> => {
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
  };

  // Deterministic handoff triggers run BEFORE any model call (free, reliable).
  const lastInbound = [...data.msgs].reverse().find((m) => m.direction === "INBOUND" && !m.private);
  if (data.agent.handoffEnabled && lastInbound) {
    const hit = checkDeterministicHandoff({
      trig: triggerConfig(data.agent),
      customerText: lastInbound.body,
      priorMessages: data.msgs.filter((m) => m.id !== lastInbound.id),
    });
    if (hit) {
      const takeoverLine = await performHandoff({
        workspaceId,
        conversationId,
        agent: data.agent,
        reason: hit.reason,
      });
      await deliverAndPersist(hit.message ?? takeoverLine);
      return true;
    }
  }

  const credits = await getCredits(workspaceId);
  if (credits.remaining <= 0) return false;

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
  if (recentReplies >= REPLIES_PER_HOUR_CAP) return false;

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

  if (text.trim()) await deliverAndPersist(text);

  await debitCredits(workspaceId, creditsForTokens(usage?.totalTokens ?? 0), {
    agentId,
    conversationId,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
  });
  return Boolean(text.trim());
}

/**
 * Workflow-action entrypoint ("Reply with AI agent"): resolves the
 * conversation's transport and runs a reply turn with the SPECIFIED agent —
 * independent of the channel's default auto-reply agent. Returns whether a
 * reply was delivered (drives the workflow's repliedExternally flag).
 */
export async function runWorkflowAgentReply(opts: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
}): Promise<boolean> {
  const { workspaceId, conversationId, agentId } = opts;
  const convo = await withTenant(workspaceId, (tx) =>
    tx.conversation.findFirst({
      where: { id: conversationId },
      select: { channelType: true, channelId: true, customerPhone: true },
    }),
  );
  if (!convo) return false;

  if (convo.channelType === "whatsapp") {
    const channel = convo.channelId
      ? await prisma.whatsAppChannel.findFirst({ where: { id: convo.channelId, workspaceId } })
      : await prisma.whatsAppChannel.findFirst({ where: { workspaceId } });
    if (!channel) return false;
    return runReplyTurn({
      workspaceId,
      conversationId,
      agentId,
      deliver: (text) => sendWhatsAppText(channel.phoneNumberId, channel.accessToken, convo.customerPhone, text),
      clearWaiting: false,
    });
  }
  if (convo.channelType === "whatsapp_web") {
    const channel = convo.channelId
      ? await prisma.waWebChannel.findFirst({ where: { id: convo.channelId, workspaceId } })
      : await prisma.waWebChannel.findFirst({ where: { workspaceId, status: "working" } });
    if (!channel) return false;
    return runReplyTurn({
      workspaceId,
      conversationId,
      agentId,
      deliver: (text) => sendGatewayText(channel.sessionName, phoneToChatId(convo.customerPhone), text),
      clearWaiting: true,
    });
  }
  if (convo.channelType === "webchat") {
    return runReplyTurn({
      workspaceId,
      conversationId,
      agentId,
      deliver: async () => undefined,
      clearWaiting: true,
    });
  }
  return false; // other channel types (meta) not supported by this action yet
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
