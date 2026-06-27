"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ObjectType } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { logEventTx } from "@/lib/activity";
import { runWorkflows } from "@/lib/workflow";
import type { WorkflowContext } from "@/lib/workflow";

export interface NoteState {
  error?: string;
  ok?: boolean;
}

const PARENT_PATH: Record<ObjectType, string> = {
  CONTACT: "/app/contacts",
  COMPANY: "/app/companies",
  DEAL: "/app/deals",
};

function parentCtx(parentType: ObjectType, parentId: string): Partial<WorkflowContext> {
  if (parentType === "CONTACT") return { contactId: parentId };
  if (parentType === "DEAL") return { dealId: parentId };
  return { companyId: parentId };
}

export async function addNote(
  parentType: ObjectType,
  parentId: string,
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const ctx = await requireAuth();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Note is empty." };
  let noteId = "";
  try {
    noteId = await withTenant(ctx.workspaceId, async (tx) => {
      const n = await tx.note.create({ data: { workspaceId: ctx.workspaceId, parentType, parentId, body } });
      await logEventTx(tx, ctx.workspaceId, parentType, parentId, "note", body.slice(0, 140), ctx.userId);
      return n.id;
    });
  } catch (e) {
    console.error("addNote failed", e);
    return { error: "Could not save the note." };
  }
  after(() =>
    runWorkflows(ctx.workspaceId, "note_created", { noteId, actorId: ctx.userId, ...parentCtx(parentType, parentId) }).catch((e) =>
      console.error("note_created workflow failed", e),
    ),
  );
  revalidatePath(`${PARENT_PATH[parentType]}/${parentId}`);
  return { ok: true };
}

export async function deleteNote(id: string, parentType: ObjectType, parentId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.note.deleteMany({ where: { id } }));
  revalidatePath(`${PARENT_PATH[parentType]}/${parentId}`);
}
