import { after } from "next/server";
import { generateText, type CoreMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { resolveModel } from "@/lib/ai";
import { getCredits, creditsForTokens, debitCredits } from "@/lib/credits";
import { sendWhatsAppText, verifyWebhookSignature, waPhoneToE164 } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

// Meta webhook verification handshake.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && !verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      const messages = value.messages ?? [];
      if (!phoneNumberId || messages.length === 0) continue;

      const channel = await prisma.whatsAppChannel.findUnique({ where: { phoneNumberId } });
      if (!channel) continue;
      const name: string | null = value.contacts?.[0]?.profile?.name ?? null;

      for (const msg of messages) {
        if (msg.type !== "text") continue;
        const phone = waPhoneToE164(msg.from);
        const text: string = msg.text?.body ?? "";
        const convoId = await persistInbound(channel.workspaceId, channel.autoReplyAgentId, phone, name, text, msg.id);

        if (channel.autoReplyAgentId && hasLlmKey()) {
          // Reply after the 200 so Meta isn't kept waiting on the model.
          after(() => autoReply(channel, convoId, phone).catch((e) => console.error("autoReply failed", e)));
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
}

async function persistInbound(
  workspaceId: string,
  autoReplyAgentId: string | null,
  phone: string,
  name: string | null,
  text: string,
  waId: string | undefined,
): Promise<string> {
  return withTenant(workspaceId, async (tx) => {
    let contact = await tx.contact.findFirst({ where: { phone, deletedAt: null } });
    if (!contact) {
      contact = await tx.contact.create({ data: { workspaceId, phone, firstName: name } });
    }
    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: { workspaceId, customerPhone: phone, customerName: name, contactId: contact.id, assignedAgentId: autoReplyAgentId },
      });
    }
    await tx.message.create({
      data: { workspaceId, conversationId: convo.id, direction: "INBOUND", body: text, waMessageId: waId },
    });
    await tx.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), status: "OPEN", customerName: name ?? convo.customerName },
    });
    return convo.id;
  });
}

async function autoReply(
  channel: { workspaceId: string; phoneNumberId: string; accessToken: string; autoReplyAgentId: string | null },
  conversationId: string,
  phone: string,
): Promise<void> {
  const agentId = channel.autoReplyAgentId;
  if (!agentId) return;

  const data = await withTenant(channel.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
    const msgs = await tx.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    return { agent, msgs };
  });
  if (!data.agent) return;

  const credits = await getCredits(channel.workspaceId);
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

  const waId = await sendWhatsAppText(channel.phoneNumberId, channel.accessToken, phone, text);

  await withTenant(channel.workspaceId, async (tx) => {
    await tx.message.create({
      data: { workspaceId: channel.workspaceId, conversationId, direction: "OUTBOUND", body: text, waMessageId: waId },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  });

  await debitCredits(channel.workspaceId, creditsForTokens(usage?.totalTokens ?? 0), {
    agentId,
    conversationId,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
  });
}
