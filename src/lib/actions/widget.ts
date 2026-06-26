"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface WidgetState {
  error?: string;
  ok?: boolean;
}

export async function saveWidget(_prev: WidgetState, formData: FormData): Promise<WidgetState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can configure the widget." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || "Chat with us";
  const color = String(formData.get("color") ?? "#FF7A59").trim().slice(0, 9) || "#FF7A59";
  const welcomeMessage = String(formData.get("welcomeMessage") ?? "").trim().slice(0, 280) || "Hi! How can we help?";
  const autoReplyAgentId = String(formData.get("autoReplyAgentId") ?? "").trim() || null;
  const enabled = formData.get("enabled") === "on";

  try {
    const existing = await prisma.webWidget.findFirst({ where: { workspaceId: ctx.workspaceId } });
    if (existing) {
      await prisma.webWidget.update({
        where: { id: existing.id },
        data: { name, color, welcomeMessage, autoReplyAgentId, enabled },
      });
    } else {
      await prisma.webWidget.create({
        data: {
          workspaceId: ctx.workspaceId,
          publicKey: randomBytes(16).toString("hex"),
          name,
          color,
          welcomeMessage,
          autoReplyAgentId,
          enabled,
        },
      });
    }
  } catch (e) {
    console.error("saveWidget failed", e);
    return { error: "Could not save the widget." };
  }
  revalidatePath("/app/inbox/widget");
  return { ok: true };
}
