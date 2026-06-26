"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ConversationStatus, ConversationPriority } from "@prisma/client";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, sendWhatsAppMedia, uploadWhatsAppMedia, mediaTypeFromMime } from "@/lib/whatsapp";

export interface ChannelState {
  error?: string;
  ok?: boolean;
}
export interface ReplyState {
  error?: string;
}

const channelSchema = z.object({
  phoneNumberId: z.string().min(3, "Phone number ID is required").max(64),
  accessToken: z.string().min(10, "Access token is required").max(1000),
  displayName: z.string().max(80).optional(),
  wabaId: z.string().max(64).optional(),
  autoReplyAgentId: z.string().uuid().optional().or(z.literal("")),
});

export async function connectChannel(_prev: ChannelState, formData: FormData): Promise<ChannelState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can connect channels." };

  const parsed = channelSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
    displayName: formData.get("displayName") || undefined,
    wabaId: formData.get("wabaId") || undefined,
    autoReplyAgentId: formData.get("autoReplyAgentId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  try {
    const existing = await prisma.whatsAppChannel.findUnique({ where: { phoneNumberId: v.phoneNumberId } });
    if (existing && existing.workspaceId !== ctx.workspaceId) {
      return { error: "That phone number is already connected to another workspace." };
    }
    const dataFields = {
      displayName: v.displayName || "WhatsApp",
      accessToken: v.accessToken,
      wabaId: v.wabaId || null,
      autoReplyAgentId: v.autoReplyAgentId || null,
    };
    await prisma.whatsAppChannel.upsert({
      where: { phoneNumberId: v.phoneNumberId },
      update: dataFields,
      create: { workspaceId: ctx.workspaceId, phoneNumberId: v.phoneNumberId, ...dataFields },
    });
  } catch (e) {
    console.error("connectChannel failed", e);
    return { error: "Could not save the channel." };
  }

  revalidatePath("/app/inbox/settings");
  revalidatePath("/app/inbox");
  return { ok: true };
}

export async function replyToConversation(
  conversationId: string,
  _prev: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const ctx = await requireAuth();
  const body = String(formData.get("body") ?? "").trim();
  const isNote = String(formData.get("kind") ?? "") === "note";
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!body && !hasFile) return { error: isNote ? "Note is empty." : "Message is empty." };

  const convo = await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.findFirst({ where: { id: conversationId } }),
  );
  if (!convo) return { error: "Conversation not found." };

  // Internal notes are visible only to the team — never sent to the customer.
  if (isNote) {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.message.create({
        data: {
          workspaceId: ctx.workspaceId,
          conversationId,
          direction: "OUTBOUND",
          private: true,
          authorUserId: ctx.userId,
          body,
          type: "text",
        },
      }),
    );
    revalidatePath("/app/inbox");
    return {};
  }

  const channel = await prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } });
  if (!channel) return { error: "Connect a WhatsApp channel first (Inbox → Settings)." };

  let waId: string | undefined;
  let type = "text";
  let mediaId: string | null = null;
  let mediaMime: string | null = null;
  let mediaFilename: string | null = null;

  try {
    if (hasFile) {
      const f = file as File;
      if (f.size > 16 * 1024 * 1024) return { error: "File too large (max 16 MB)." };
      const mime = f.type || "application/octet-stream";
      type = mediaTypeFromMime(mime);
      mediaMime = mime;
      mediaFilename = f.name;
      mediaId = await uploadWhatsAppMedia(channel.phoneNumberId, channel.accessToken, f, mime, f.name);
      waId = await sendWhatsAppMedia(
        channel.phoneNumberId,
        channel.accessToken,
        convo.customerPhone,
        type as "image" | "video" | "audio" | "document",
        mediaId,
        body || undefined,
        f.name,
      );
    } else {
      waId = await sendWhatsAppText(channel.phoneNumberId, channel.accessToken, convo.customerPhone, body);
    }
  } catch (e) {
    console.error("replyToConversation send failed", e);
    return { error: e instanceof Error ? e.message : "Failed to send message." };
  }

  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.message.create({
      data: {
        workspaceId: ctx.workspaceId,
        conversationId,
        direction: "OUTBOUND",
        authorUserId: ctx.userId,
        body,
        type,
        mediaId,
        mediaMime,
        mediaFilename,
        waMessageId: waId,
      },
    });
    // An agent reply clears the "waiting on us" clock and records first-response time.
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        waitingSince: null,
        ...(convo.firstReplyAt ? {} : { firstReplyAt: new Date() }),
      },
    });
  });

  revalidatePath("/app/inbox");
  return {};
}

export async function assignAgent(conversationId: string, agentId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.update({
      where: { id: conversationId },
      data: { assignedAgentId: agentId || null },
    }),
  );
  revalidatePath("/app/inbox");
}

export async function assignConversationUser(conversationId: string, userId: string): Promise<void> {
  const ctx = await requireAuth();
  // Guard: only assign to an actual member of this workspace.
  if (userId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
    });
    if (!member) return;
  }
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.update({ where: { id: conversationId }, data: { assignedUserId: userId || null } }),
  );
  revalidatePath("/app/inbox");
}

export async function setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.update({
      where: { id: conversationId },
      // Leaving SNOOZED/resolving clears the snooze timer.
      data: { status, ...(status === "SNOOZED" ? {} : { snoozedUntil: null }) },
    }),
  );
  revalidatePath("/app/inbox");
}

export async function setConversationPriority(
  conversationId: string,
  priority: ConversationPriority,
): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.update({ where: { id: conversationId }, data: { priority } }),
  );
  revalidatePath("/app/inbox");
}

/** Snooze a conversation for N minutes; it auto-reopens when a new message arrives or the timer lapses. */
export async function snoozeConversation(conversationId: string, minutes: number): Promise<void> {
  const ctx = await requireAuth();
  const mins = Math.max(1, Math.min(minutes, 60 * 24 * 30)); // 1 min … 30 days
  const until = new Date(Date.now() + mins * 60_000);
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversation.update({
      where: { id: conversationId },
      data: { status: "SNOOZED", snoozedUntil: until },
    }),
  );
  revalidatePath("/app/inbox");
}
