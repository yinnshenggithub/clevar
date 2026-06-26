"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";

const PALETTE = ["#64748b", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

function pickColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export async function createLabel(name: string, color?: string): Promise<{ id: string } | null> {
  const ctx = await requireAuth();
  const clean = name.trim().slice(0, 40);
  if (!clean) return null;
  const label = await withTenant(ctx.workspaceId, async (tx) => {
    const existing = await tx.label.findFirst({ where: { name: clean } });
    if (existing) return existing;
    return tx.label.create({
      data: { workspaceId: ctx.workspaceId, name: clean, color: color || pickColor(clean) },
    });
  });
  revalidatePath("/app/inbox");
  return { id: label.id };
}

export async function deleteLabel(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.label.delete({ where: { id } }));
  revalidatePath("/app/inbox");
}

export async function addConversationLabel(conversationId: string, labelId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    const exists = await tx.conversationLabel.findFirst({ where: { conversationId, labelId } });
    if (exists) return;
    await tx.conversationLabel.create({ data: { workspaceId: ctx.workspaceId, conversationId, labelId } });
  });
  revalidatePath("/app/inbox");
}

export async function removeConversationLabel(conversationId: string, labelId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) =>
    tx.conversationLabel.deleteMany({ where: { conversationId, labelId } }),
  );
  revalidatePath("/app/inbox");
}

/** Inline create-and-apply for the conversation labels picker. */
export async function createAndApplyLabel(conversationId: string, name: string): Promise<void> {
  const created = await createLabel(name);
  if (created) await addConversationLabel(conversationId, created.id);
}
