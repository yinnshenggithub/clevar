import "server-only";
import { generateText, type CoreMessage } from "ai";
import { withTenant } from "./tenant";
import { prisma } from "./prisma";
import { resolveModel } from "./ai";
import { getCredits, creditsForTokens, debitCredits } from "./credits";
import { sendWhatsAppText } from "./whatsapp";
import { sendGatewayText, phoneToChatId } from "./wa-web";
import { sendMetaMessage } from "./meta";
import { retrieveContext } from "./knowledge";
import { buildAgentSystemPrompt, styleMaxTokens, type AgentConfig } from "./agent-presets";
import { buildActionTools, type AgentActions } from "./agent-actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toConfig(agent: any): AgentConfig {
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
  };
}

function asActions(value: unknown): AgentActions {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AgentActions) : {};
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** Loads everything a reply turn needs: agent, recent messages, linked contact, labels, teammates. */
async function loadTurn(workspaceId: string, conversationId: string, agentId: string) {
  const [tenant, members] = await Promise.all([
    withTenant(workspaceId, async (tx) => {
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      const convo = await tx.conversation.findFirst({ where: { id: conversationId }, select: { contactId: true } });
      const msgs = await tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 20 });
      const labels = await tx.label.findMany({ select: { id: true, name: true } });
      return { agent, convo, msgs, labels };
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);
  return { ...tenant, members: members.map((m) => ({ id: m.user.id, name: m.user.fullName })) };
}

/** Runs one agent turn with action tools wired in. Tools mutate live (dryRun: false). */
async function generateTurn(opts: {
  workspaceId: string;
  conversationId: string;
  agent: any;
  coreMessages: CoreMessage[];
  contactId?: string | null;
  members: { id: string; name: string }[];
  labels: { id: string; name: string }[];
}) {
  const { workspaceId, conversationId, agent, coreMessages, contactId, members, labels } = opts;
  const lastUserText = [...coreMessages].reverse().find((m) => m.role === "user")?.content;
  const context = await retrieveContext(workspaceId, agent.id, typeof lastUserText === "string" ? lastUserText : "");
  const system = buildAgentSystemPrompt(toConfig(agent), context);
  const { tools } = buildActionTools({
    workspaceId,
    conversationId,
    contactId,
    actions: asActions(agent.actions),
    members,
    labels,
    dryRun: false,
  });
  const hasTools = Object.keys(tools).length > 0;

  return generateText({
    model: resolveModel(agent.model),
    system,
    messages: coreMessages,
    temperature: agent.temperature ?? 0.5,
    maxTokens: styleMaxTokens(agent.responseStyle ?? "balanced"),
    ...(hasTools ? { tools, maxSteps: 5 } : {}),
  });
}

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

  const coreMessages: CoreMessage[] = data.msgs
    .filter((m) => !m.private)
    .map((m) => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.body }));

  const { text, usage } = await generateTurn({
    workspaceId,
    conversationId,
    agent: data.agent,
    coreMessages,
    contactId: data.convo?.contactId,
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
