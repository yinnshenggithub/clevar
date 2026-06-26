"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";

export interface CannedState {
  error?: string;
  ok?: boolean;
}

const schema = z.object({
  shortcode: z
    .string()
    .min(1, "Shortcode is required")
    .max(40)
    .transform((s) => s.trim().replace(/^\//, "").toLowerCase().replace(/\s+/g, "-")),
  title: z.string().min(1, "Title is required").max(120),
  content: z.string().min(1, "Content is required").max(4000),
});

export async function createCanned(_prev: CannedState, formData: FormData): Promise<CannedState> {
  const ctx = await requireAuth();
  const parsed = schema.safeParse({
    shortcode: formData.get("shortcode"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.cannedResponse.create({ data: { workspaceId: ctx.workspaceId, ...parsed.data } }),
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) return { error: "That shortcode is already in use." };
    console.error("createCanned failed", e);
    return { error: "Could not save the response." };
  }
  revalidatePath("/app/inbox/canned");
  return { ok: true };
}

export async function updateCanned(id: string, _prev: CannedState, formData: FormData): Promise<CannedState> {
  const ctx = await requireAuth();
  const parsed = schema.safeParse({
    shortcode: formData.get("shortcode"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.cannedResponse.update({ where: { id }, data: parsed.data }),
    );
  } catch (e) {
    console.error("updateCanned failed", e);
    return { error: "Could not update the response." };
  }
  revalidatePath("/app/inbox/canned");
  return { ok: true };
}

export async function deleteCanned(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.cannedResponse.deleteMany({ where: { id } }));
  revalidatePath("/app/inbox/canned");
}
