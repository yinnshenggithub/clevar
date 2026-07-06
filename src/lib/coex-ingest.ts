import "server-only";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaNS } from "@prisma/client";
import { withTenant } from "./tenant";
import { waPhoneToE164 } from "./whatsapp";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Serializes concurrent writers of the same customer thread (parallel history
 * chunks, echo vs live webhook) for the rest of the transaction — conversations
 * have no unique key on (workspace, phone, channelType), so find-or-create
 * needs this to avoid duplicate threads. Auto-released at COMMIT.
 */
async function lockThread(tx: PrismaNS.TransactionClient, workspaceId: string, phone: string): Promise<void> {
  const key = `${workspaceId}|${phone}|whatsapp`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
}

/**
 * Webhook-side ingestion for the coexistence-only fields Meta adds on top of
 * the standard "messages" webhook:
 *
 *   smb_message_echoes — messages the owner sends from the WhatsApp Business
 *                        app on their phone → mirrored as OUTBOUND rows.
 *   history            — the one-time 180-day chat backfill, delivered in
 *                        chunks after onboarding.
 *   smb_app_state_sync — the phone's contact book (initial burst + updates).
 *
 * None of these run the automation chain: they are the business's own data,
 * not new customer activity.
 */

export interface CoexChannel {
  id: string;
  workspaceId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ParsedContent {
  type: string;
  body: string;
  mediaId: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
}

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker", "voice"];

/**
 * Extracts displayable content from an echo/history message object (same
 * shape as the standard inbound webhook). History media older than 14 days
 * arrives as a placeholder with no asset id — keep the row, drop the media.
 */
function parseContent(msg: any): ParsedContent | null {
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
  if (msg.type === "media_placeholder") {
    return { type: "text", body: "[Attachment — not included in history sync]", mediaId: null, mediaMime: null, mediaFilename: null };
  }
  return null; // reactions, locations, contacts, system — skipped
}

function tsToDate(timestamp: unknown): Date {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n * 1000);
}

/**
 * Mirrors one app-sent message (smb_message_echoes) into the customer's
 * conversation as an OUTBOUND row. Handles `edit` (update body in place) and
 * `revoke` (mark deleted). Dedupes by wamid so redeliveries are no-ops.
 */
export async function persistWaEcho(channel: CoexChannel, echo: any): Promise<void> {
  const phone = waPhoneToE164(String(echo.to ?? ""));
  const wamid: string | null = echo.id ?? null;
  if (!phone || phone === "+" || !wamid) return;

  await withTenant(channel.workspaceId, async (tx) => {
    await lockThread(tx, channel.workspaceId, phone);
    // Edits and revokes reference the original message's wamid.
    if (echo.type === "edit" || echo.type === "revoke") {
      const target = await tx.message.findFirst({ where: { waMessageId: wamid }, select: { id: true } });
      if (!target) return;
      await tx.message.update({
        where: { id: target.id },
        data:
          echo.type === "edit"
            ? { body: echo.text?.body ?? "" }
            : { body: "This message was deleted", type: "text", mediaId: null, mediaMime: null, mediaFilename: null },
      });
      return;
    }

    const parsed = parseContent(echo);
    if (!parsed) return;

    const dupe = await tx.message.findFirst({ where: { waMessageId: wamid }, select: { id: true } });
    if (dupe) return; // redelivery, or a message our own API send already stored

    let contact = await tx.contact.findFirst({ where: { phone, deletedAt: null } });
    if (!contact) {
      contact = await tx.contact.create({ data: { workspaceId: channel.workspaceId, phone } });
    }

    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone, channelType: "whatsapp" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          channelType: "whatsapp",
          channelId: channel.id,
          customerPhone: phone,
          contactId: contact.id,
        },
      });
    }

    const sentAt = tsToDate(echo.timestamp);
    try {
      await tx.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: convo.id,
          direction: "OUTBOUND",
          body: parsed.body,
          type: parsed.type,
          mediaId: parsed.mediaId,
          mediaMime: parsed.mediaMime,
          mediaFilename: parsed.mediaFilename,
          waMessageId: wamid,
          createdAt: sentAt,
        },
      });
    } catch (e) {
      // Unique (workspace, wamid) — a concurrent delivery or our own API send
      // already stored this message.
      if (isUniqueViolation(e)) return;
      throw e;
    }
    await tx.conversation.update({
      where: { id: convo.id },
      // The owner replied from their phone — stop the "waiting on us" clock,
      // exactly like a reply sent from the inbox.
      data: {
        lastMessageAt: sentAt > convo.lastMessageAt ? sentAt : convo.lastMessageAt,
        waitingSince: null,
        ...(convo.firstReplyAt ? {} : { firstReplyAt: sentAt }),
        ...(convo.contactId ? {} : { contactId: contact.id }),
        ...(convo.channelId ? {} : { channelId: channel.id }),
      },
    });
  });
}

/**
 * Imports one `history` webhook chunk. Threads are keyed the same way live
 * traffic is (customerPhone + channelType "whatsapp") so the backfill lands in
 * the same conversations later messages will. Historical threads that don't
 * exist yet are created RESOLVED so a 180-day import doesn't flood the open
 * inbox. Everything is idempotent on wamid.
 */
export async function persistHistoryChunk(channel: CoexChannel, historyItems: any[]): Promise<void> {
  for (const item of historyItems ?? []) {
    // The business declined history sharing during onboarding (error 2593109).
    if (Array.isArray(item?.errors) && item.errors.length > 0) {
      console.info("wa history sync declined/errored", item.errors[0]?.code);
      continue;
    }
    for (const thread of item?.threads ?? []) {
      const phone = waPhoneToE164(String(thread?.id ?? ""));
      if (!phone || phone === "+") continue;
      const rows: {
        direction: "INBOUND" | "OUTBOUND";
        body: string;
        type: string;
        mediaId: string | null;
        mediaMime: string | null;
        mediaFilename: string | null;
        waMessageId: string;
        createdAt: Date;
      }[] = [];
      for (const msg of thread?.messages ?? []) {
        if (!msg?.id || !msg?.from) continue; // direction is undecidable without a sender
        const parsed = parseContent(msg);
        if (!parsed) continue;
        rows.push({
          // In a business↔customer thread, anything the customer sent comes
          // "from" the thread's phone; the rest is ours.
          direction: waPhoneToE164(String(msg.from ?? "")) === phone ? "INBOUND" : "OUTBOUND",
          body: parsed.body,
          type: parsed.type,
          mediaId: parsed.mediaId,
          mediaMime: parsed.mediaMime,
          mediaFilename: parsed.mediaFilename,
          waMessageId: String(msg.id),
          createdAt: tsToDate(msg.timestamp),
        });
      }
      if (rows.length === 0) continue;

      try {
        await withTenant(channel.workspaceId, async (tx) => {
          // Chunks of the same thread arrive on concurrent invocations —
          // serialize per (workspace, phone) so find-or-create can't fork the
          // conversation.
          await lockThread(tx, channel.workspaceId, phone);
          let contact = await tx.contact.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
          if (!contact) {
            contact = await tx.contact.create({
              data: { workspaceId: channel.workspaceId, phone },
              select: { id: true },
            });
          }

          let convo = await tx.conversation.findFirst({
            where: { customerPhone: phone, channelType: "whatsapp" },
            orderBy: { lastMessageAt: "desc" },
          });
          const newest = rows.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), rows[0].createdAt);
          if (!convo) {
            convo = await tx.conversation.create({
              data: {
                workspaceId: channel.workspaceId,
                channelType: "whatsapp",
                channelId: channel.id,
                customerPhone: phone,
                contactId: contact.id,
                status: "RESOLVED",
                lastMessageAt: newest,
              },
            });
          }

          // Bounded slices keep IN-lists and insert statements small so a huge
          // thread can't blow the transaction budget; skipDuplicates leans on
          // the (workspace, wamid) unique index for race-safe idempotency.
          const SLICE = 200;
          for (let at = 0; at < rows.length; at += SLICE) {
            const slice = rows.slice(at, at + SLICE);
            const existing = await tx.message.findMany({
              where: { conversationId: convo.id, waMessageId: { in: slice.map((r) => r.waMessageId) } },
              select: { waMessageId: true },
            });
            const seen = new Set(existing.map((m) => m.waMessageId));
            const fresh = slice.filter((r) => !seen.has(r.waMessageId));
            if (fresh.length > 0) {
              await tx.message.createMany({
                data: fresh.map((r) => ({
                  workspaceId: channel.workspaceId,
                  conversationId: convo!.id,
                  ...r,
                })),
                skipDuplicates: true,
              });
            }
          }
          if (newest > convo.lastMessageAt) {
            await tx.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: newest } });
          }
        });
      } catch (e) {
        // One bad thread shouldn't sink the chunk — Meta won't redeliver it.
        console.error("wa history thread import failed", phone, e);
      }
    }
  }
}

/**
 * Applies smb_app_state_sync contact events: `add` creates the contact (or
 * fills in a missing name); `remove` is ignored — deleting CRM data because a
 * phone contact was removed would be destructive.
 */
export async function persistStateSync(channel: CoexChannel, items: any[]): Promise<void> {
  const adds = (items ?? []).filter((i) => i?.type === "contact" && i?.action === "add" && i?.contact?.phone_number);
  // The initial burst can be the whole phone book — process in bounded slices
  // so each tenant transaction stays well under its timeout.
  const SLICE = 40;
  for (let at = 0; at < adds.length; at += SLICE) {
    const slice = adds.slice(at, at + SLICE);
    try {
      await withTenant(channel.workspaceId, async (tx) => {
        for (const item of slice) {
          const phone = waPhoneToE164(String(item.contact.phone_number));
          if (!phone || phone === "+") continue;
          const fullName: string = String(item.contact.full_name ?? item.contact.first_name ?? "").trim();
          const existing = await tx.contact.findFirst({
            where: { phone, deletedAt: null },
            select: { id: true, firstName: true, lastName: true },
          });
          if (!existing) {
            await tx.contact.create({
              data: { workspaceId: channel.workspaceId, phone, firstName: fullName || null },
            });
          } else if (fullName && !existing.firstName && !existing.lastName) {
            await tx.contact.update({ where: { id: existing.id }, data: { firstName: fullName } });
          }
        }
      });
    } catch (e) {
      console.error("wa contact sync slice failed", e);
    }
  }
}
