"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
