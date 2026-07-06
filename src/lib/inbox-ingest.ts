import "server-only";
import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { runWorkflows } from "./workflow";
import { evaluateAgentRules } from "./agent-rules";
import { hasLlmKey, runAgentReply, runWaWebAgentReply } from "./agent-reply";
import type { WaChannelKind } from "./wa-send";

/**
 * Shared inbound pipeline for the two WhatsApp transports (Cloud API webhook
 * and the web-linked gateway). Persists the message under tenant RLS, then the
 * caller runs the automation chain post-ack via processWaMessageReceived.
 */

export interface WaIngestChannel {
  kind: WaChannelKind;
  id: string;
  workspaceId: string;
  autoReplyAgentId: string | null;
  /** Cloud API credentials — present when kind === "whatsapp". */
  phoneNumberId?: string;
  accessToken?: string;
  /** Gateway session — present when kind === "whatsapp_web". */
  sessionName?: string;
}

export interface WaInboundMessage {
  type: string; // text | image | video | audio | document | sticker
  body: string;
  mediaId?: string | null;
  mediaMime?: string | null;
  mediaFilename?: string | null;
  /** Provider message id — used to drop webhook redeliveries. */
  externalId?: string | null;
}

const CHANNEL_TYPE: Record<WaChannelKind, string> = {
  whatsapp: "whatsapp",
  whatsapp_web: "whatsapp_web",
};

/**
 * Find-or-create the contact + conversation and append the INBOUND message.
 * Conversations are keyed by (customerPhone, channelType) so a Cloud and a
 * web-linked channel for the same customer stay separate threads while sharing
 * one Contact. Returns the conversation id, or null when the message is a
 * duplicate redelivery.
 */
export async function persistWaInbound(
  channel: WaIngestChannel,
  phone: string,
  name: string | null,
  msg: WaInboundMessage,
): Promise<string | null> {
  const channelType = CHANNEL_TYPE[channel.kind];
  return withTenant(channel.workspaceId, async (tx) => {
    // Serialize concurrent writers of this customer's thread (webhook
    // redeliveries, coexistence history/echo imports) so find-or-create can't
    // fork the conversation. Released at COMMIT.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${channel.workspaceId}|${phone}|${channelType}`})::bigint)`;
    let contact = await tx.contact.findFirst({ where: { phone, deletedAt: null } });
    if (!contact) {
      contact = await tx.contact.create({ data: { workspaceId: channel.workspaceId, phone, firstName: name } });
    }

    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone, channelType },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          channelType,
          channelId: channel.id,
          customerPhone: phone,
          customerName: name,
          contactId: contact.id,
          assignedAgentId: channel.autoReplyAgentId,
        },
      });
    }

    // Gateways can redeliver on reconnect — drop messages we already stored.
    if (msg.externalId) {
      const dupe = await tx.message.findFirst({
        where: { conversationId: convo.id, waMessageId: msg.externalId },
        select: { id: true },
      });
      if (dupe) return null;
    }

    try {
      await tx.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: convo.id,
          direction: "INBOUND",
          body: msg.body,
          type: msg.type,
          mediaId: msg.mediaId ?? null,
          mediaMime: msg.mediaMime ?? null,
          mediaFilename: msg.mediaFilename ?? null,
          waMessageId: msg.externalId ?? null,
        },
      });
    } catch (e) {
      // Unique (workspace, wamid) — concurrent redelivery beat us to it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    }
    await tx.conversation.update({
      where: { id: convo.id },
      // A new inbound message reopens the conversation, clears any snooze, and
      // starts the "waiting on us" clock used by reporting/SLA.
      data: {
        lastMessageAt: new Date(),
        status: "OPEN",
        snoozedUntil: null,
        waitingSince: new Date(),
        customerName: name ?? convo.customerName,
        ...(convo.channelId ? {} : { channelId: channel.id }),
        // Conversations opened by an owner-initiated (echo) message have no
        // contact yet — link it on the customer's first reply.
        ...(convo.contactId ? {} : { contactId: contact.id }),
      },
    });
    return convo.id;
  });
}

/**
 * Post-ack automation chain, identical for both transports: workflows first
 * (which may reply externally), then no-LLM agent rules, then the AI reply.
 */
export async function processWaMessageReceived(
  channel: WaIngestChannel,
  conversationId: string,
  phone: string,
  messageText: string,
): Promise<void> {
  const { repliedExternally } = await runWorkflows(channel.workspaceId, "message_received", {
    conversationId,
    messageText,
    customerPhone: phone,
    channel: { kind: channel.kind, id: channel.id },
  });
  if (repliedExternally) return;

  const convo = await withTenant(channel.workspaceId, (tx) =>
    tx.conversation.findFirst({ where: { id: conversationId } }),
  );
  if (!convo?.assignedAgentId) return;

  // If-then rules (keyword / "asks for a human") run without an LLM and can
  // hand off to a human before any AI reply.
  const { handedOff } = await evaluateAgentRules({
    workspaceId: channel.workspaceId,
    conversationId,
    agentId: convo.assignedAgentId,
    messageText,
  });
  if (handedOff) return;

  if (!hasLlmKey()) return;
  if (channel.kind === "whatsapp_web" && channel.sessionName) {
    await runWaWebAgentReply({
      workspaceId: channel.workspaceId,
      conversationId,
      agentId: convo.assignedAgentId,
      sessionName: channel.sessionName,
      phone,
    });
  } else if (channel.kind === "whatsapp" && channel.phoneNumberId && channel.accessToken) {
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
