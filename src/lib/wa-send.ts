import "server-only";
import { prisma } from "./prisma";
import { sendWhatsAppText } from "./whatsapp";
import { phoneToChatId, sendGatewayText } from "./wa-web";

/**
 * WhatsApp send dispatch shared by the inbox reply action, macros, workflow
 * send steps, and AI agent replies. Two transports exist for the same customer
 * phone number space:
 *   - "whatsapp"      → Cloud API (WhatsAppChannel: phoneNumberId + accessToken)
 *   - "whatsapp_web"  → web-linked number via the messaging gateway (WaWebChannel)
 *
 * A conversation is bound to its channel row via Conversation.channelId;
 * legacy rows (null) fall back to the workspace's first channel of that kind.
 */

export type WaChannelKind = "whatsapp" | "whatsapp_web";

/** Serializable channel reference — safe to persist in workflow run context. */
export interface WaChannelRef {
  kind: WaChannelKind;
  id: string;
}

export type WaTransport =
  | { kind: "whatsapp"; channelId: string; phoneNumberId: string; accessToken: string }
  | { kind: "whatsapp_web"; channelId: string; sessionName: string };

/** Resolve the transport for a conversation from its channel binding (with legacy fallback). */
export async function resolveConversationTransport(
  workspaceId: string,
  convo: { channelType: string; channelId: string | null },
): Promise<WaTransport | null> {
  if (convo.channelType === "whatsapp_web") {
    const ch = convo.channelId
      ? await prisma.waWebChannel.findFirst({ where: { id: convo.channelId, workspaceId } })
      : await prisma.waWebChannel.findFirst({
          where: { workspaceId, enabled: true, status: "working" },
          orderBy: { createdAt: "asc" },
        });
    return ch ? { kind: "whatsapp_web", channelId: ch.id, sessionName: ch.sessionName } : null;
  }
  const ch = convo.channelId
    ? await prisma.whatsAppChannel.findFirst({ where: { id: convo.channelId, workspaceId } })
    : await prisma.whatsAppChannel.findFirst({ where: { workspaceId } });
  return ch
    ? { kind: "whatsapp", channelId: ch.id, phoneNumberId: ch.phoneNumberId, accessToken: ch.accessToken }
    : null;
}

/** Resolve a persisted `{kind, id}` reference (workflow context) to live credentials at send time. */
export async function resolveRefTransport(workspaceId: string, ref: WaChannelRef): Promise<WaTransport | null> {
  if (ref.kind === "whatsapp_web") {
    const ch = await prisma.waWebChannel.findFirst({ where: { id: ref.id, workspaceId } });
    return ch ? { kind: "whatsapp_web", channelId: ch.id, sessionName: ch.sessionName } : null;
  }
  const ch = await prisma.whatsAppChannel.findFirst({ where: { id: ref.id, workspaceId } });
  return ch
    ? { kind: "whatsapp", channelId: ch.id, phoneNumberId: ch.phoneNumberId, accessToken: ch.accessToken }
    : null;
}

/** Send a text message over either WhatsApp transport; returns the provider message id. */
export async function sendWaText(t: WaTransport, toPhone: string, text: string): Promise<string | undefined> {
  if (t.kind === "whatsapp_web") return sendGatewayText(t.sessionName, phoneToChatId(toPhone), text);
  return sendWhatsAppText(t.phoneNumberId, t.accessToken, toPhone, text);
}
