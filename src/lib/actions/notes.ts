"use server";

import { revalidatePath } from "next/cache";
import type { ObjectType } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { logEventTx } from "@/lib/activity";

export interface NoteState {
  error?: string;
  ok?: boolean;
}

const PARENT_PATH: Record<ObjectType, string> = {
  CONTACT: "/app/contacts",
  COMPANY: "/app/companies",
  DEAL: "/app/deals",
};

export async function addNote(
  parentType: ObjectType,
  parentId: string,
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const ctx = await requireAuth();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Note is empty." };
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.note.create({ data: { workspaceId: ctx.workspaceId, parentType, parentId, body } });
      await logEventTx(tx, ctx.workspaceId, parentType, parentId, "note", body.slice(0, 140), ctx.userId);
    });
  } catch (e) {
    console.error("addNote failed", e);
    return { error: "Could not save the note." };
  }
  revalidatePath(`${PARENT_PATH[parentType]}/${parentId}`);
  return { ok: true };
}

export async function deleteNote(id: string, parentType: ObjectType, parentId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.note.deleteMany({ where: { id } }));
  revalidatePath(`${PARENT_PATH[parentType]}/${parentId}`);
}
