"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  createGatewaySession,
  deleteGatewaySession,
  logoutGatewaySession,
  newSessionName,
  requestGatewayPairingCode,
  waWebConfigured,
} from "@/lib/wa-web";

export interface WaWebStartState {
  error?: string;
  channelId?: string;
}

/**
 * Start pairing a web-linked WhatsApp number: create (or reuse) the channel
 * row and boot a gateway session. The connect UI then polls
 * /api/wa-web/status/[id] for QR + status transitions.
 */
export async function startWaWebPairing(): Promise<WaWebStartState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can link numbers." };
  if (!waWebConfigured()) return { error: "The messaging gateway isn't configured yet." };

  try {
    // Reuse a NEVER-PAIRED row if one exists so retries don't accumulate
    // sessions. Rows with a phoneNumber are real (possibly signed-out) linked
    // numbers — recycling one would silently replace it.
    let channel = await prisma.waWebChannel.findFirst({
      where: { workspaceId: ctx.workspaceId, status: { notIn: ["working"] }, phoneNumber: null },
      orderBy: { createdAt: "desc" },
    });
    if (!channel) {
      channel = await prisma.waWebChannel.create({
        data: { workspaceId: ctx.workspaceId, sessionName: newSessionName(), status: "starting" },
      });
    } else {
      await prisma.waWebChannel.update({ where: { id: channel.id }, data: { status: "starting" } });
    }
    await createGatewaySession(channel.sessionName, env().NEXT_PUBLIC_APP_URL);
    return { channelId: channel.id };
  } catch (e) {
    console.error("startWaWebPairing failed", e);
    return { error: "Couldn't reach the messaging gateway. Try again in a moment." };
  }
}

const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .refine((s) => /^\+?\d{7,15}$/.test(s), "Enter the full number with country code.");

export interface WaWebCodeState {
  error?: string;
  code?: string;
}

/** "Link with phone number" — request an 8-character pairing code instead of scanning the QR. */
export async function requestWaWebCode(channelId: string, phoneRaw: string): Promise<WaWebCodeState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can link numbers." };

  const parsed = phoneSchema.safeParse(phoneRaw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid phone number." };

  const channel = await prisma.waWebChannel.findFirst({ where: { id: channelId, workspaceId: ctx.workspaceId } });
  if (!channel) return { error: "Pairing session not found." };

  try {
    const code = await requestGatewayPairingCode(channel.sessionName, parsed.data);
    if (!code) return { error: "Couldn't get a code — scan the QR instead." };
    return { code };
  } catch (e) {
    console.error("requestWaWebCode failed", e);
    return { error: "Couldn't get a code — scan the QR instead." };
  }
}

/**
 * Restart a failed/expired/signed-out session so a fresh QR is issued. Recreate
 * the session if the gateway dropped it (logout deletes gateway-side state).
 * Returns the channel id so the connect wizard can resume polling for the QR.
 */
export async function retryWaWebPairing(channelId: string): Promise<WaWebStartState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can link numbers." };
  const channel = await prisma.waWebChannel.findFirst({ where: { id: channelId, workspaceId: ctx.workspaceId } });
  if (!channel) return { error: "Channel not found." };
  try {
    await prisma.waWebChannel.update({ where: { id: channel.id }, data: { status: "starting" } });
    // createGatewaySession restarts an existing session or recreates a missing one.
    await createGatewaySession(channel.sessionName, env().NEXT_PUBLIC_APP_URL);
    revalidatePath("/app/inbox/channels");
    return { channelId: channel.id };
  } catch (e) {
    console.error("retryWaWebPairing failed", e);
    return { error: "Couldn't reach the messaging gateway. Try again in a moment." };
  }
}

/** Unlink a number: sign the device out, drop the gateway session, delete the channel row. */
export async function disconnectWaWebChannel(channelId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const channel = await prisma.waWebChannel.findFirst({ where: { id: channelId, workspaceId: ctx.workspaceId } });
  if (!channel) return;
  await logoutGatewaySession(channel.sessionName);
  await deleteGatewaySession(channel.sessionName);
  await prisma.waWebChannel.delete({ where: { id: channel.id } });
  revalidatePath("/app/inbox/channels");
  revalidatePath("/app/inbox");
}

export interface WaWebUpdateState {
  error?: string;
  ok?: boolean;
}

const updateSchema = z.object({
  displayName: z.string().max(80).optional(),
  autoReplyAgentId: z.string().uuid().optional().or(z.literal("")),
});

/** Update a linked number's display name / auto-reply agent. */
export async function updateWaWebChannel(
  channelId: string,
  _prev: WaWebUpdateState,
  formData: FormData,
): Promise<WaWebUpdateState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage channels." };

  const parsed = updateSchema.safeParse({
    displayName: formData.get("displayName") || undefined,
    autoReplyAgentId: formData.get("autoReplyAgentId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const updated = await prisma.waWebChannel.updateMany({
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
