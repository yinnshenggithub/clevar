"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ObjectType } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { logEventTx } from "@/lib/activity";
import { runWorkflows } from "@/lib/workflow";
import type { WorkflowContext } from "@/lib/workflow";

export interface TaskState {
  error?: string;
  ok?: boolean;
}

const PARENT_PATH: Record<ObjectType, string> = {
  CONTACT: "/app/contacts",
  COMPANY: "/app/companies",
  DEAL: "/app/deals",
};

/** Map a task's parent record onto workflow-context identity fields. */
function parentCtx(parentType: ObjectType | null, parentId: string | null): Partial<WorkflowContext> {
  if (!parentType || !parentId) return {};
  if (parentType === "CONTACT") return { contactId: parentId };
  if (parentType === "DEAL") return { dealId: parentId };
  return { companyId: parentId };
}

function revalidateParent(parentType: ObjectType | null, parentId: string | null) {
  revalidatePath("/app/tasks");
  if (parentType && parentId) revalidatePath(`${PARENT_PATH[parentType]}/${parentId}`);
}

export async function createTask(_prev: TaskState, formData: FormData): Promise<TaskState> {
  const ctx = await requireAuth();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const body = String(formData.get("body") ?? "").trim() || null;
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  const parentTypeRaw = String(formData.get("parentType") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim() || null;
  const parentType = (["CONTACT", "COMPANY", "DEAL"].includes(parentTypeRaw) ? parentTypeRaw : null) as ObjectType | null;
  if (!title) return { error: "Task title is required." };

  let taskId = "";
  try {
    taskId = await withTenant(ctx.workspaceId, async (tx) => {
      const t = await tx.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          title,
          body,
          dueAt: dueRaw ? new Date(dueRaw) : null,
          assigneeId,
          parentType,
          parentId,
          createdById: ctx.userId,
        },
      });
      if (parentType && parentId) {
        await logEventTx(tx, ctx.workspaceId, parentType, parentId, "task_created", `Task: ${title}`, ctx.userId);
      }
      return t.id;
    });
  } catch (e) {
    console.error("createTask failed", e);
    return { error: "Could not create the task." };
  }
  after(() =>
    runWorkflows(ctx.workspaceId, "task_created", { taskId, recordName: title, actorId: ctx.userId, ...parentCtx(parentType, parentId) }).catch(
      (e) => console.error("task_created workflow failed", e),
    ),
  );
  revalidateParent(parentType, parentId);
  return { ok: true };
}

export async function toggleTask(id: string): Promise<void> {
  const ctx = await requireAuth();
  const completed = await withTenant(ctx.workspaceId, async (tx) => {
    const task = await tx.task.findFirst({ where: { id } });
    if (!task) return null;
    const done = task.status !== "DONE";
    await tx.task.update({
      where: { id },
      data: { status: done ? "DONE" : "TODO", completedAt: done ? new Date() : null },
    });
    if (done && task.parentType && task.parentId) {
      await logEventTx(tx, ctx.workspaceId, task.parentType, task.parentId, "task_completed", `Completed: ${task.title}`, ctx.userId);
    }
    return done ? { title: task.title, parentType: task.parentType, parentId: task.parentId } : null;
  });
  if (completed) {
    after(() =>
      runWorkflows(ctx.workspaceId, "task_completed", {
        taskId: id,
        recordName: completed.title,
        actorId: ctx.userId,
        ...parentCtx(completed.parentType, completed.parentId),
      }).catch((e) => console.error("task_completed workflow failed", e)),
    );
  }
  revalidatePath("/app/tasks");
  revalidatePath("/app/contacts", "layout");
  revalidatePath("/app/companies", "layout");
  revalidatePath("/app/deals", "layout");
}

export async function deleteTask(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.task.deleteMany({ where: { id } }));
  revalidatePath("/app/tasks");
  revalidatePath("/app/contacts", "layout");
  revalidatePath("/app/companies", "layout");
  revalidatePath("/app/deals", "layout");
}
