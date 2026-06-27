"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { StageType, DealStatus } from "@prisma/client";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { logEventTx } from "@/lib/activity";
import { dispatchWebhooks } from "@/lib/webhooks";
import { runWorkflows } from "@/lib/workflow";

export interface FormState {
  error?: string;
}

const STATUS_FOR_STAGE: Record<StageType, DealStatus> = { OPEN: "OPEN", WON: "WON", LOST: "LOST" };

const DEFAULT_STAGES = [
  { name: "Lead", position: 0, stageType: "OPEN" as const },
  { name: "Qualified", position: 1, stageType: "OPEN" as const },
  { name: "Proposal", position: 2, stageType: "OPEN" as const },
  { name: "Won", position: 3, stageType: "WON" as const },
  { name: "Lost", position: 4, stageType: "LOST" as const },
];

function revalidatePipelines(): void {
  revalidatePath("/app/deals");
  revalidatePath("/app/settings/pipelines");
}

// ── Pipelines ───────────────────────────────────────────────────────────────

export async function createPipeline(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage pipelines." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Pipeline name is required." };

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const count = await tx.pipeline.count();
      const pipeline = await tx.pipeline.create({
        data: { workspaceId: ctx.workspaceId, name, isDefault: count === 0, position: count },
      });
      await tx.stage.createMany({
        data: DEFAULT_STAGES.map((s) => ({ ...s, workspaceId: ctx.workspaceId, pipelineId: pipeline.id })),
      });
    });
  } catch (e) {
    console.error("createPipeline failed", e);
    return { error: "Could not create the pipeline." };
  }
  revalidatePipelines();
  return {};
}

export async function renamePipeline(id: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await withTenant(ctx.workspaceId, (tx) => tx.pipeline.update({ where: { id }, data: { name } }));
  revalidatePipelines();
}

export async function setDefaultPipeline(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.pipeline.updateMany({ data: { isDefault: false } });
    await tx.pipeline.update({ where: { id }, data: { isDefault: true } });
  });
  revalidatePipelines();
}

export async function deletePipeline(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const total = await tx.pipeline.count();
    if (total <= 1) return; // never delete the last pipeline
    const dealCount = await tx.deal.count({ where: { pipelineId: id, deletedAt: null } });
    if (dealCount > 0) return; // refuse while deals still live here
    const target = await tx.pipeline.findFirst({ where: { id }, select: { isDefault: true } });
    await tx.stage.deleteMany({ where: { pipelineId: id } });
    await tx.pipeline.delete({ where: { id } });
    if (target?.isDefault) {
      const next = await tx.pipeline.findFirst({ orderBy: { position: "asc" } });
      if (next) await tx.pipeline.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  revalidatePipelines();
}

// ── Stages ────────────────────────────────────────────────────────────────

const stageTypeSchema = z.enum(["OPEN", "WON", "LOST"]);

export async function addStage(pipelineId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const name = String(formData.get("name") ?? "").trim();
  const parsedType = stageTypeSchema.safeParse(String(formData.get("stageType") ?? "OPEN"));
  if (!name) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const pipeline = await tx.pipeline.findFirst({ where: { id: pipelineId }, select: { id: true } });
    if (!pipeline) return;
    const count = await tx.stage.count({ where: { pipelineId } });
    await tx.stage.create({
      data: {
        workspaceId: ctx.workspaceId,
        pipelineId,
        name,
        position: count,
        stageType: parsedType.success ? parsedType.data : "OPEN",
      },
    });
  });
  revalidatePipelines();
}

export async function renameStage(id: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const name = String(formData.get("name") ?? "").trim();
  const parsedType = stageTypeSchema.safeParse(String(formData.get("stageType") ?? "OPEN"));
  if (!name) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.stage.update({ where: { id }, data: { name, ...(parsedType.success ? { stageType: parsedType.data } : {}) } }),
  );
  revalidatePipelines();
}

export async function deleteStage(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id }, select: { pipelineId: true } });
    if (!stage) return;
    const stageCount = await tx.stage.count({ where: { pipelineId: stage.pipelineId } });
    if (stageCount <= 1) return; // keep at least one stage
    const dealCount = await tx.deal.count({ where: { stageId: id, deletedAt: null } });
    if (dealCount > 0) return; // refuse while deals still live here
    await tx.stage.delete({ where: { id } });
  });
  revalidatePipelines();
}

export async function reorderStage(id: string, direction: "up" | "down"): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id }, select: { pipelineId: true } });
    if (!stage) return;
    const stages = await tx.stage.findMany({ where: { pipelineId: stage.pipelineId }, orderBy: { position: "asc" } });
    const i = stages.findIndex((s) => s.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= stages.length) return;
    await tx.stage.update({ where: { id: stages[i].id }, data: { position: stages[j].position } });
    await tx.stage.update({ where: { id: stages[j].id }, data: { position: stages[i].position } });
  });
  revalidatePipelines();
}

// ── Quick-add deal from a board column ───────────────────────────────────────

export async function quickCreateDeal(pipelineId: string, stageId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const created = await withTenant(ctx.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId, pipelineId } });
    if (!stage) throw new Error("STAGE_NOT_FOUND");
    const deal = await tx.deal.create({
      data: {
        workspaceId: ctx.workspaceId,
        title,
        currency: "USD",
        pipelineId,
        stageId,
        status: STATUS_FOR_STAGE[stage.stageType],
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    });
    await logEventTx(tx, ctx.workspaceId, "DEAL", deal.id, "created", `Deal created: ${title}`, ctx.userId);
    return deal;
  });
  after(() =>
    runWorkflows(ctx.workspaceId, "deal_created", { dealId: created.id, recordName: title }).catch((e) =>
      console.error("deal_created workflow failed", e),
    ),
  );
  after(() => dispatchWebhooks(ctx.workspaceId, "deal.created", { id: created.id, title, amount: null }));
  revalidatePath("/app/deals");
}
