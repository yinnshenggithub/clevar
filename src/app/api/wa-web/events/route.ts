import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { mediaTypeFromMime } from "@/lib/whatsapp";
import {
  chatIdToPhone,
  mapGatewayStatus,
  toStoredMediaId,
  verifyGatewayWebhook,
  waWebConfigured,
} from "@/lib/wa-web";
import { persistWaInbound, processWaMessageReceived, type WaIngestChannel } from "@/lib/inbox-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ingest for messaging-gateway events (web-linked WhatsApp sessions).
 * Auth is strict HMAC over the raw body — unlike third-party webhooks, this is
 * an internal trusted link, so an unconfigured secret refuses instead of
 * skipping verification (same posture as /api/cron).
 */
export async function POST(req: Request) {
  if (!waWebConfigured()) return new Response("gateway not configured", { status: 503 });

  const raw = await req.text();
  if (!verifyGatewayWebhook(raw, req.headers.get("x-webhook-hmac"))) {
    return new Response("invalid signature", { status: 401 });
  }

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const sessionName: string | undefined = evt?.session;
  if (!sessionName) return new Response("ok", { status: 200 });

  const channel = await prisma.waWebChannel.findUnique({ where: { sessionName } });
  // Unknown session → ack so the gateway doesn't retry forever.
  if (!channel) return new Response("ok", { status: 200 });

  try {
    if (evt.event === "session.status") {
      await handleSessionStatus(channel.id, evt);
    } else if (evt.event === "message.any" || evt.event === "message") {
      await handleMessage(channel, evt);
    }
  } catch (e) {
    console.error("wa-web event failed", evt?.event, e);
  }

  return new Response("ok", { status: 200 });
}

async function handleSessionStatus(channelId: string, evt: any): Promise<void> {
  const status = mapGatewayStatus(evt?.payload?.status);
  const mePhone = chatIdToPhone(evt?.me?.id);
  await prisma.waWebChannel.update({
    where: { id: channelId },
    data: {
      status,
      lastSeenAt: new Date(),
      ...(status === "working" && mePhone ? { phoneNumber: mePhone } : {}),
    },
  });
}

async function handleMessage(
  channel: { id: string; workspaceId: string; autoReplyAgentId: string | null; sessionName: string; enabled: boolean },
  evt: any,
): Promise<void> {
  if (!channel.enabled) return;
  const p = evt?.payload ?? {};
  const externalId: string | null = typeof p.id === "string" ? p.id : null;

  // 1:1 chats only — group / broadcast / channel ids don't map to a phone.
  const partnerChatId: string | undefined = p.fromMe ? p.to : p.from;
  const phone = chatIdToPhone(partnerChatId);
  if (!phone || p.participant) return;

  const hasMedia = Boolean(p.hasMedia);
  const media = {
    mediaId: hasMedia && p.media?.url ? toStoredMediaId(String(p.media.url)) : null,
    mediaMime: hasMedia ? ((p.media?.mimetype as string) ?? null) : null,
    mediaFilename: hasMedia ? ((p.media?.filename as string) ?? null) : null,
  };
  const type = media.mediaMime ? mediaTypeFromMime(media.mediaMime) : hasMedia ? "document" : "text";
  let body = String(p.body ?? "");
  if (!body && !hasMedia) return;
  if (hasMedia && !media.mediaId) {
    // Media exists but the gateway didn't host a file (download disabled,
    // over the size cap, …) — keep the message so the thread and automation
    // still fire, with a visible placeholder instead of a broken bubble.
    console.warn("wa-web: inbound media without file url", { session: evt?.session, id: externalId });
    if (!body) body = media.mediaFilename ?? "Attachment (not available)";
  }

  if (p.fromMe) {
    // Messages we sent through the gateway API are persisted by the send path
    // itself — only mirror messages typed on the linked phone. This also
    // avoids racing the send path's own insert.
    if (p.source === "api") return;
    await persistEcho(channel, phone, { body, type, externalId, ...media });
    return;
  }

  const ingestChannel: WaIngestChannel = {
    kind: "whatsapp_web",
    id: channel.id,
    workspaceId: channel.workspaceId,
    autoReplyAgentId: channel.autoReplyAgentId,
    sessionName: channel.sessionName,
  };
  // Best-effort sender display name; the field location varies by gateway engine.
  const name: string | null =
    (p._data?.pushName as string) ?? (p._data?.notifyName as string) ?? (p._data?.Info?.PushName as string) ?? null;

  const convoId = await persistWaInbound(ingestChannel, phone, name, {
    type,
    body,
    externalId,
    ...media,
  });
  if (!convoId) return; // duplicate redelivery

  after(() =>
    processWaMessageReceived(ingestChannel, convoId, phone, body).catch((e) =>
      console.error("processWaMessageReceived failed", e),
    ),
  );
}

/**
 * A message sent from the linked phone itself (or by our own send API, echoed
 * back). Mirrors it as OUTBOUND so the inbox shows the full thread; replies we
 * sent ourselves are dropped by the message-id dedupe.
 */
async function persistEcho(
  channel: { id: string; workspaceId: string; autoReplyAgentId: string | null },
  phone: string,
  msg: { body: string; type: string; externalId: string | null; mediaId: string | null; mediaMime: string | null; mediaFilename: string | null },
): Promise<void> {
  await withTenant(channel.workspaceId, async (tx) => {
    if (msg.externalId) {
      const dupe = await tx.message.findFirst({
        where: { waMessageId: msg.externalId },
        select: { id: true },
      });
      if (dupe) return;
    }
    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone, channelType: "whatsapp_web" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          channelType: "whatsapp_web",
          channelId: channel.id,
          customerPhone: phone,
          assignedAgentId: channel.autoReplyAgentId,
        },
      });
    }
    await tx.message.create({
      data: {
        workspaceId: channel.workspaceId,
        conversationId: convo.id,
        direction: "OUTBOUND",
        body: msg.body,
        type: msg.type,
        mediaId: msg.mediaId,
        mediaMime: msg.mediaMime,
        mediaFilename: msg.mediaFilename,
        waMessageId: msg.externalId,
      },
    });
    await tx.conversation.update({
      where: { id: convo.id },
      // The owner replied from their phone — the customer is no longer waiting.
      data: { lastMessageAt: new Date(), waitingSince: null },
    });
  });
}
