"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

export interface WebhookState {
  error?: string;
  ok?: boolean;
}

export async function createWebhook(_prev: WebhookState, formData: FormData): Promise<WebhookState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage webhooks." };
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return { error: "Enter a valid http(s) URL." };
  const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) return { error: "Pick at least one event." };
  try {
    await prisma.webhook.create({
      data: { workspaceId: ctx.workspaceId, url, events, secret: randomBytes(16).toString("hex") },
    });
  } catch (e) {
    console.error("createWebhook failed", e);
    return { error: "Could not save the webhook." };
  }
  revalidatePath("/app/settings");
  return { ok: true };
}

export async function deleteWebhook(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await prisma.webhook.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  revalidatePath("/app/settings");
}
