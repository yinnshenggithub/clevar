import "server-only";
import { generateText, type CoreMessage } from "ai";
import { withTenant } from "./tenant";
import { resolveModel } from "./ai";
import { getCredits, creditsForTokens, debitCredits } from "./credits";
import { sendWhatsAppText } from "./whatsapp";

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** Generates an AI reply for a conversation and sends it over WhatsApp, debiting credits. */
export async function runAgentReply(opts: {
  workspaceId: string;
  phoneNumberId: string;
  accessToken: string;
  conversationId: string;
  phone: string;
  agentId: string;
}): Promise<void> {
  const { workspaceId, phoneNumberId, accessToken, conversationId, phone, agentId } = opts;
  if (!hasLlmKey()) return;

  const data = await withTenant(workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
    const msgs = await tx.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    return { agent, msgs };
  });
  if (!data.agent) return;

  const credits = await getCredits(workspaceId);
  if (credits.remaining <= 0) return;

  const coreMessages: CoreMessage[] = data.msgs.map((m) => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.body,
  }));

  const { text, usage } = await generateText({
    model: resolveModel(data.agent.model),
    system: data.agent.instructions?.trim() || `You are ${data.agent.name}, a helpful WhatsApp assistant. Be concise.`,
    messages: coreMessages,
  });

  const waId = await sendWhatsAppText(phoneNumberId, accessToken, phone, text);

  await withTenant(workspaceId, async (tx) => {
    await tx.message.create({
      data: { workspaceId, conversationId, direction: "OUTBOUND", body: text, waMessageId: waId },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  });

  await debitCredits(workspaceId, creditsForTokens(usage?.totalTokens ?? 0), {
    agentId,
    conversationId,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
  });
}
