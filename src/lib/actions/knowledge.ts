"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";

export interface DocState {
  error?: string;
  ok?: boolean;
}

const docSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Add some content").max(100_000),
});

export async function addDocument(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();

  let content = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");
  if ((!content || content.length === 0) && file instanceof File && file.size > 0) {
    if (file.size > 1024 * 1024) return { error: "File too large (max 1 MB of text)." };
    content = (await file.text()).trim();
  }
  const title = String(formData.get("title") ?? "").trim();

  const parsed = docSchema.safeParse({ title, content });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw new Error("AGENT_NOT_FOUND");
      await tx.agentDocument.create({
        data: { workspaceId: ctx.workspaceId, agentId, title: parsed.data.title, content: parsed.data.content },
      });
    });
  } catch (e) {
    console.error("addDocument failed", e);
    return { error: "Could not save the document." };
  }
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

export async function deleteDocument(agentId: string, documentId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.agentDocument.deleteMany({ where: { id: documentId, agentId } }));
  revalidatePath(`/app/agents/${agentId}`);
}
