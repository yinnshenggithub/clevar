import "server-only";
import type { WebWidget, Message } from "@prisma/client";
import { prisma } from "./prisma";
import { withTenant } from "./tenant";

export function visitorPhone(visitorId: string): string {
  return `web:${visitorId}`;
}

export interface WireMessage {
  id: string;
  direction: string;
  body: string;
  at: string;
}

function wire(m: Message): WireMessage {
  return { id: m.id, direction: m.direction, body: m.body, at: m.createdAt.toISOString() };
}

export async function getEnabledWidget(key: string): Promise<WebWidget | null> {
  const w = await prisma.webWidget.findUnique({ where: { publicKey: key } });
  return w && w.enabled ? w : null;
}

export async function startWebConversation(widget: WebWidget, visitorId: string, name: string | null) {
  return withTenant(widget.workspaceId, async (tx) => {
    const phone = visitorPhone(visitorId);
    let convo = await tx.conversation.findFirst({
      where: { customerPhone: phone, channelType: "webchat" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!convo) {
      convo = await tx.conversation.create({
        data: {
          workspaceId: widget.workspaceId,
          channelType: "webchat",
          customerPhone: phone,
          customerName: name || "Website visitor",
          assignedAgentId: widget.autoReplyAgentId,
          waitingSince: new Date(),
        },
      });
    } else if (name && convo.customerName !== name) {
      await tx.conversation.update({ where: { id: convo.id }, data: { customerName: name } });
    }
    const messages = await tx.message.findMany({
      where: { conversationId: convo.id, private: false },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return { conversationId: convo.id, messages: messages.map(wire) };
  });
}

/** Persists a visitor's inbound message; returns the conversation id or null if it doesn't match. */
export async function addVisitorMessage(
  widget: WebWidget,
  conversationId: string,
  visitorId: string,
  body: string,
): Promise<string | null> {
  return withTenant(widget.workspaceId, async (tx) => {
    const convo = await tx.conversation.findFirst({
      where: { id: conversationId, customerPhone: visitorPhone(visitorId), channelType: "webchat" },
    });
    if (!convo) return null;
    await tx.message.create({
      data: { workspaceId: widget.workspaceId, conversationId, direction: "INBOUND", body, type: "text" },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), status: "OPEN", waitingSince: new Date() },
    });
    return conversationId;
  });
}

export async function pollMessages(
  widget: WebWidget,
  conversationId: string,
  visitorId: string,
  afterIso: string | null,
): Promise<WireMessage[] | null> {
  return withTenant(widget.workspaceId, async (tx) => {
    const convo = await tx.conversation.findFirst({
      where: { id: conversationId, customerPhone: visitorPhone(visitorId), channelType: "webchat" },
    });
    if (!convo) return null;
    const after = afterIso ? new Date(afterIso) : new Date(0);
    const messages = await tx.message.findMany({
      where: { conversationId, private: false, createdAt: { gt: after } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return messages.map(wire);
  });
}
