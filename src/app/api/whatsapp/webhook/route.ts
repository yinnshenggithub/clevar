import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature, waPhoneToE164 } from "@/lib/whatsapp";
import { persistWaInbound, processWaMessageReceived, type WaIngestChannel } from "@/lib/inbox-ingest";
import { persistWaEcho, persistHistoryChunk, persistStateSync } from "@/lib/coex-ingest";

export const runtime = "nodejs";
// History backfill chunks are processed post-ack in after() — give them room.
export const maxDuration = 300;

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

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const raw = await req.text();

  // META_APP_SECRET fallback: the coexistence connect flow requires it, and
  // Meta signs with the same app secret — so enabling coexistence always
  // enforces signatures even if WHATSAPP_APP_SECRET was never duplicated.
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
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
      const field: string = change.field ?? "messages";
      const value = change.value ?? {};
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Coexistence lifecycle: the owner disconnected (or reconnected) the
      // number from inside the WhatsApp Business app.
      if (field === "account_offboarded" || field === "account_reconnected") {
        await prisma.whatsAppChannel.updateMany({
          where: { phoneNumberId },
          data: { status: field === "account_reconnected" ? "connected" : "offboarded" },
        });
        continue;
      }

      const channel = await prisma.whatsAppChannel.findUnique({ where: { phoneNumberId } });
      if (!channel) continue;

      // Coexistence mirrors + backfill. These are the business's own data, so
      // they skip the automation chain; the heavy ones run post-ack.
      if (field === "smb_message_echoes") {
        const echoes = value.message_echoes ?? [];
        after(async () => {
          for (const echo of echoes) {
            await persistWaEcho(channel, echo).catch((e) => console.error("persistWaEcho failed", e));
          }
        });
        continue;
      }
      if (field === "history") {
        after(() =>
          persistHistoryChunk(channel, value.history ?? []).catch((e) =>
            console.error("persistHistoryChunk failed", e),
          ),
        );
        continue;
      }
      if (field === "smb_app_state_sync") {
        after(() =>
          persistStateSync(channel, value.state_sync ?? []).catch((e) => console.error("persistStateSync failed", e)),
        );
        continue;
      }
      if (field !== "messages") continue;

      const messages = value.messages ?? [];
      if (messages.length === 0) continue;
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
