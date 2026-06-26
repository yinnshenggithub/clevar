import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { verifyWebhookSignature, waPhoneToE164 } from "@/lib/whatsapp";
import { runWorkflows } from "@/lib/workflow";
import { runAgentReply, hasLlmKey } from "@/lib/agent-reply";

export const runtime = "nodejs";
export const maxDuration = 60;

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

type Channel = {
  workspaceId: string;
  phoneNumberId: string;
  accessToken: string;
  autoReplyAgentId: string | null;
};

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
        const phone = waPhoneToE164(msg.from);
        const parsed = parseInbound(msg);
        if (!parsed) continue; // unsupported message type
        const convoId = await persistInbound(channel, phone, name, parsed, msg.id);
        // Process automation + AI reply after acking Meta with a 200.
        after(() =>
          processMessageReceived(channel, convoId, phone, parsed.body).catch((e) =>
            console.error("processMessageReceived failed", e),
          ),
        );
      }
    }
  }

  return new Response("ok", { status: 200 });
}

interface ParsedInbound {
  type: string;
  body: string;
  mediaId: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
}

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker", "voice"];

/** Extracts text or media from a WhatsApp inbound message; null for unsupported types. */
function parseInbound(msg: any): ParsedInbound | null {
  if (msg.type === "text") {
    return { type: "text", body: msg.text?.body ?? "", mediaId: null, mediaMime: null, mediaFilename: null };
  }
  if (MEDIA_TYPES.includes(msg.type)) {
    const media = msg[msg.type] ?? {};
    return {
      type: msg.type === "voice" ? "audio" : msg.type,
      body: media.caption ?? "",
      mediaId: media.id ?? null,
      mediaMime: media.mime_type ?? null,
      mediaFilename: media.filename ?? null,
    };
  }
  return null;
}

async function persistInbound(
  channel: Channel,
  phone: string,
  name: string | null,
  parsed: ParsedInbound,
  waId: string | undefined,
): Promise<string> {
  return withTenant(channel.workspaceId, async (tx) => {
    let contact = await tx.contact.findFirst({ where: { phone, deletedAt: null } });
    if (!contact) {
      contact = await tx.contact.create({ data: { workspaceId: channel.workspaceId, phone, firstName: name } });
    }
    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          customerPhone: phone,
          customerName: name,
          contactId: contact.id,
          assignedAgentId: channel.autoReplyAgentId,
        },
      });
    }
    await tx.message.create({
      data: {
        workspaceId: channel.workspaceId,
        conversationId: convo.id,
        direction: "INBOUND",
        body: parsed.body,
        type: parsed.type,
        mediaId: parsed.mediaId,
        mediaMime: parsed.mediaMime,
        mediaFilename: parsed.mediaFilename,
        waMessageId: waId,
      },
    });
    await tx.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), status: "OPEN", customerName: name ?? convo.customerName },
    });
    return convo.id;
  });
}

async function processMessageReceived(
  channel: Channel,
  conversationId: string,
  phone: string,
  messageText: string,
): Promise<void> {
  const { repliedExternally } = await runWorkflows(channel.workspaceId, "message_received", {
    conversationId,
    messageText,
    customerPhone: phone,
    channel: { phoneNumberId: channel.phoneNumberId, accessToken: channel.accessToken },
  });
  if (repliedExternally) return;

  const convo = await withTenant(channel.workspaceId, (tx) =>
    tx.conversation.findFirst({ where: { id: conversationId } }),
  );
  if (convo?.assignedAgentId && hasLlmKey()) {
    await runAgentReply({
      workspaceId: channel.workspaceId,
      phoneNumberId: channel.phoneNumberId,
      accessToken: channel.accessToken,
      conversationId,
      phone,
      agentId: convo.assignedAgentId,
    });
  }
}
