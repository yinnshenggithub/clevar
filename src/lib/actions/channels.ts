"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  coexConfigured,
  exchangeEsCode,
  getWabaPhoneNumbers,
  registerCloudNumber,
  requestSmbAppSync,
  subscribeAppToWaba,
  unsubscribeAppFromWaba,
} from "@/lib/wa-coex";

export interface ChannelState {
  error?: string;
  ok?: boolean;
}

async function guardOwnership(provider: string, externalId: string, workspaceId: string): Promise<boolean> {
  const existing = await prisma.channelConnection.findUnique({ where: { provider_externalId: { provider, externalId } } });
  return !existing || existing.workspaceId === workspaceId;
}

const metaSchema = z.object({
  pageId: z.string().min(2, "Page ID is required").max(64),
  accessToken: z.string().min(10, "Page access token is required").max(1000),
  igUserId: z.string().max(64).optional(),
  pageName: z.string().max(120).optional(),
  autoReplyAgentId: z.string().uuid().optional().or(z.literal("")),
});

export async function connectMeta(_prev: ChannelState, formData: FormData): Promise<ChannelState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can connect channels." };
  const parsed = metaSchema.safeParse({
    pageId: formData.get("pageId"),
    accessToken: formData.get("accessToken"),
    igUserId: formData.get("igUserId") || undefined,
    pageName: formData.get("pageName") || undefined,
    autoReplyAgentId: formData.get("autoReplyAgentId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  if (!(await guardOwnership("meta", v.pageId, ctx.workspaceId)))
    return { error: "That Page is already connected to another workspace." };

  const config = {
    igUserId: v.igUserId || null,
    pageName: v.pageName || null,
    features: {
      messenger: formData.get("featMessenger") === "on",
      instagram: formData.get("featInstagram") === "on",
      leadgen: formData.get("featLeadgen") === "on",
    },
  } as Prisma.InputJsonValue;

  try {
    await prisma.channelConnection.upsert({
      where: { provider_externalId: { provider: "meta", externalId: v.pageId } },
      update: { accessToken: v.accessToken, config, autoReplyAgentId: v.autoReplyAgentId || null, enabled: true },
      create: { workspaceId: ctx.workspaceId, provider: "meta", externalId: v.pageId, accessToken: v.accessToken, config, autoReplyAgentId: v.autoReplyAgentId || null },
    });
  } catch (e) {
    console.error("connectMeta failed", e);
    return { error: "Could not save the connection." };
  }
  revalidatePath("/app/inbox/channels");
  return { ok: true };
}

const tiktokSchema = z.object({
  advertiserId: z.string().min(2, "Advertiser ID is required").max(64),
  accessToken: z.string().min(6, "Access token is required").max(1000),
  advertiserName: z.string().max(120).optional(),
});

export async function connectTikTok(_prev: ChannelState, formData: FormData): Promise<ChannelState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can connect channels." };
  const parsed = tiktokSchema.safeParse({
    advertiserId: formData.get("advertiserId"),
    accessToken: formData.get("accessToken"),
    advertiserName: formData.get("advertiserName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  if (!(await guardOwnership("tiktok", v.advertiserId, ctx.workspaceId)))
    return { error: "That advertiser is already connected to another workspace." };

  try {
    await prisma.channelConnection.upsert({
      where: { provider_externalId: { provider: "tiktok", externalId: v.advertiserId } },
      update: { accessToken: v.accessToken, config: { advertiserName: v.advertiserName || null } as Prisma.InputJsonValue, enabled: true },
      create: { workspaceId: ctx.workspaceId, provider: "tiktok", externalId: v.advertiserId, accessToken: v.accessToken, config: { advertiserName: v.advertiserName || null } as Prisma.InputJsonValue },
    });
  } catch (e) {
    console.error("connectTikTok failed", e);
    return { error: "Could not save the connection." };
  }
  revalidatePath("/app/inbox/channels");
  return { ok: true };
}

export async function disconnectChannel(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await prisma.channelConnection.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  revalidatePath("/app/inbox/channels");
}

// ── WhatsApp Embedded Signup (Coexistence) ────────────────────────────────────

const esSchema = z.object({
  code: z.string().min(4).max(2048),
  wabaId: z.string().regex(/^\d{4,32}$/, "Invalid WhatsApp account id"),
  phoneNumberId: z
    .string()
    .regex(/^\d{4,32}$/)
    .optional(),
  coex: z.boolean(),
});

export interface EsResult {
  error?: string;
  ok?: boolean;
  /** Non-fatal follow-up the user should know about. */
  warning?: string;
  displayPhoneNumber?: string | null;
}

/**
 * Completes Meta Embedded Signup: exchanges the popup's auth code for a
 * business token, resolves the phone number on the granted WABA, subscribes
 * our webhooks, and saves the channel. For coexistence numbers (existing
 * WhatsApp Business app) it also kicks off the one-time contact + 180-day
 * history sync; for brand-new Cloud numbers it attempts registration instead.
 */
export async function completeEmbeddedSignup(input: {
  code: string;
  wabaId: string;
  phoneNumberId?: string;
  coex: boolean;
}): Promise<EsResult> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can connect channels." };
  if (!coexConfigured()) return { error: "WhatsApp connect isn't enabled on this server yet." };

  const parsed = esSchema.safeParse(input);
  if (!parsed.success) return { error: "The signup session looks invalid — please try connecting again." };
  const v = parsed.data;

  try {
    const token = await exchangeEsCode(v.code);

    const phones = await getWabaPhoneNumbers(v.wabaId, token);
    const phone = (v.phoneNumberId && phones.find((p) => p.id === v.phoneNumberId)) || phones[0];
    if (!phone) return { error: "No phone number was found on that WhatsApp account." };

    const existing = await prisma.whatsAppChannel.findUnique({ where: { phoneNumberId: phone.id } });
    if (existing && existing.workspaceId !== ctx.workspaceId) {
      return { error: "That WhatsApp number is already connected to another workspace." };
    }
    // A reconnect of an already-live coexistence number must not re-run the
    // one-time 180-day history import.
    const alreadyLiveCoex = existing?.mode === "coexistence" && existing?.status === "connected";

    // Save the channel BEFORE subscribing: once Meta starts sending webhooks,
    // the row must exist or events are silently dropped.
    await prisma.whatsAppChannel.upsert({
      where: { phoneNumberId: phone.id },
      update: {
        wabaId: v.wabaId,
        accessToken: token,
        mode: v.coex ? "coexistence" : "cloud",
        status: "connected",
        displayName: phone.verifiedName || "WhatsApp",
        displayPhoneNumber: phone.displayPhoneNumber,
      },
      create: {
        workspaceId: ctx.workspaceId,
        phoneNumberId: phone.id,
        wabaId: v.wabaId,
        accessToken: token,
        mode: v.coex ? "coexistence" : "cloud",
        status: "connected",
        displayName: phone.verifiedName || "WhatsApp",
        displayPhoneNumber: phone.displayPhoneNumber,
      },
    });

    await subscribeAppToWaba(v.wabaId, token);

    let warning: string | undefined;
    if (v.coex && !alreadyLiveCoex) {
      // Must run within 24h of onboarding — fire both, surface (don't fail on)
      // problems so the channel row still lands.
      try {
        await requestSmbAppSync(phone.id, token, "smb_app_state_sync");
        await requestSmbAppSync(phone.id, token, "history");
      } catch (e) {
        console.error("smb_app_data sync request failed", e);
        warning = "Connected, but chat-history sync couldn't start. Disconnect and reconnect to retry.";
      }
    } else if (!v.coex) {
      // Brand-new Cloud number from the standard flow — needs registration
      // before it can send. Coexistence numbers must NOT be registered.
      try {
        await registerCloudNumber(phone.id, token);
      } catch (e) {
        console.error("cloud number registration failed", e);
        warning = "Connected — finish number registration in Meta's WhatsApp Manager before sending.";
      }
    }

    revalidatePath("/app/inbox/channels");
    revalidatePath("/app/inbox/settings");
    return { ok: true, warning, displayPhoneNumber: phone.displayPhoneNumber };
  } catch (e) {
    console.error("completeEmbeddedSignup failed", e);
    return { error: "Couldn't finish connecting with Meta. Please try again." };
  }
}

const waUpdateSchema = z.object({
  displayName: z.string().max(80).optional(),
  autoReplyAgentId: z.string().uuid().optional().or(z.literal("")),
});

/** Update a WhatsApp number's display name / auto-reply agent. */
export async function updateWhatsAppChannel(
  channelId: string,
  _prev: ChannelState,
  formData: FormData,
): Promise<ChannelState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage channels." };
  const parsed = waUpdateSchema.safeParse({
    displayName: formData.get("displayName") || undefined,
    autoReplyAgentId: formData.get("autoReplyAgentId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const updated = await prisma.whatsAppChannel.updateMany({
    where: { id: channelId, workspaceId: ctx.workspaceId },
    data: {
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
      autoReplyAgentId: parsed.data.autoReplyAgentId || null,
    },
  });
  if (updated.count === 0) return { error: "Channel not found." };
  revalidatePath("/app/inbox/channels");
  return { ok: true };
}

/**
 * Disconnect a WhatsApp number from Clevar: unsubscribe our webhooks from the
 * WABA (best-effort) and delete the channel row. For coexistence numbers the
 * owner can also fully offboard from the phone: WhatsApp Business app →
 * Settings → Business tools → WhatsApp Business Platform.
 */
export async function disconnectWhatsAppChannel(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const channel = await prisma.whatsAppChannel.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!channel) return;
  if (channel.wabaId) await unsubscribeAppFromWaba(channel.wabaId, channel.accessToken);
  await prisma.whatsAppChannel.delete({ where: { id: channel.id } });
  revalidatePath("/app/inbox/channels");
  revalidatePath("/app/inbox/settings");
  revalidatePath("/app/inbox");
}
