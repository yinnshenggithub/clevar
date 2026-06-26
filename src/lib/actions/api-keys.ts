"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api-auth";

export interface ApiKeyState {
  error?: string;
  key?: string; // raw key, shown once
}

export async function createApiKey(_prev: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can create API keys." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || "API key";
  const { raw, hash, prefix } = generateApiKey();
  try {
    await prisma.apiKey.create({ data: { workspaceId: ctx.workspaceId, name, prefix, keyHash: hash } });
  } catch (e) {
    console.error("createApiKey failed", e);
    return { error: "Could not create the key." };
  }
  revalidatePath("/app/settings");
  return { key: raw };
}

export async function revokeApiKey(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await prisma.apiKey.updateMany({
    where: { id, workspaceId: ctx.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/app/settings");
}
