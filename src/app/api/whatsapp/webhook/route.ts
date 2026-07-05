import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature, waPhoneToE164 } from "@/lib/whatsapp";
import { persistWaInbound, processWaMessageReceived, type WaIngestChannel } from "@/lib/inbox-ingest";

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
      const ingestChannel: WaIngestChannel = {
        kind: "whatsapp",
        id: channel.id,
        workspaceId: channel.workspaceId,
        autoReplyAgentId: channel.autoReplyAgentId,
        phoneNumberId: channel.phoneNumberId,
        accessToken: channel.accessToken,
      };
      const name: string | null = value.contacts?.[0]?.profile?.name ?? null;

      for (const msg of messages) {
        const phone = waPhoneToE164(msg.from);
        const parsed = parseInbound(msg);
        if (!parsed) continue; // unsupported message type
        const convoId = await persistWaInbound(ingestChannel, phone, name, {
          type: parsed.type,
          body: parsed.body,
          mediaId: parsed.mediaId,
          mediaMime: parsed.mediaMime,
          mediaFilename: parsed.mediaFilename,
          externalId: msg.id ?? null,
        });
        if (!convoId) continue; // duplicate redelivery
        // Process automation + AI reply after acking Meta with a 200.
        after(() =>
          processWaMessageReceived(ingestChannel, convoId, phone, parsed.body).catch((e) =>
            console.error("processWaMessageReceived failed", e),
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
