"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { Prisma, type StageType, type DealStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { cleanupAssociations } from "@/lib/associations";
import { listFields } from "@/lib/objects-registry";
import { readValues, missingRequired } from "@/lib/field-values";
import { logEventTx } from "@/lib/activity";
import { dispatchWebhooks } from "@/lib/webhooks";
import { runWorkflows } from "@/lib/workflow";

export interface FormState {
  error?: string;
}

const statusForStage: Record<StageType, DealStatus> = {
  OPEN: "OPEN",
  WON: "WON",
  LOST: "LOST",
};

const dealSchema = z.object({
  title: z.string().min(1, "Deal title is required").max(200),
  amount: z.string().optional(),
  currency: z.string().length(3).optional(),
  pipelineId: z.string().uuid("Select a pipeline"),
  stageId: z.string().uuid("Select a stage"),
  companyId: z.string().uuid().optional().or(z.literal("")),
  expectedCloseAt: z.string().optional(),
});

function readDeal(formData: FormData) {
  return dealSchema.safeParse({
    title: formData.get("title"),
    amount: formData.get("amount") || undefined,
    currency: formData.get("currency") || "USD",
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    companyId: formData.get("companyId") || "",
    expectedCloseAt: formData.get("expectedCloseAt") || undefined,
  });
}

function parseAmount(raw?: string): string | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (Number.isNaN(n) || n < 0) return null;
  return n.toFixed(2);
}

async function syncDealContacts(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  workspaceId: string,
  dealId: string,
  contactIds: string[],
): Promise<void> {
  await tx.dealContact.deleteMany({ where: { dealId } });
  if (contactIds.length > 0) {
    await tx.dealContact.createMany({
      data: contactIds.map((contactId) => ({ workspaceId, dealId, contactId })),
      skipDuplicates: true,
    });
  }
}

export async function createDeal(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readDeal(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  try {
    const created = await withTenant(ctx.workspaceId, async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { id: v.stageId, pipelineId: v.pipelineId },
      });
      if (!stage) throw new Error("STAGE_NOT_FOUND");
      if (v.companyId) {
        const company = await tx.company.findFirst({ where: { id: v.companyId, deletedAt: null } });
        if (!company) throw new Error("COMPANY_NOT_FOUND");
      }
      const fieldDefs = await listFields(tx, "deal");
      const customFields = readValues(fieldDefs, formData, true);
      const missing = missingRequired(fieldDefs, customFields);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      const deal = await tx.deal.create({
        data: {
          workspaceId: ctx.workspaceId,
          title: v.title,
          amount: parseAmount(v.amount),
          currency: (v.currency || "USD").toUpperCase(),
          pipelineId: v.pipelineId,
          stageId: v.stageId,
          status: statusForStage[stage.stageType],
          companyId: v.companyId || null,
          expectedCloseAt: v.expectedCloseAt ? new Date(v.expectedCloseAt) : null,
          customFields: customFields as Prisma.InputJsonValue,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      await syncDealContacts(tx, ctx.workspaceId, deal.id, formData.getAll("contactIds").map(String).filter(Boolean));
      await logEventTx(tx, ctx.workspaceId, "DEAL", deal.id, "created", `Deal created: ${v.title}`, ctx.userId);
      return deal;
    });
    after(() =>
      runWorkflows(ctx.workspaceId, "deal_created", { dealId: created.id, recordName: v.title }).catch((e) =>
        console.error("deal_created workflow failed", e),
      ),
    );
    after(() =>
      dispatchWebhooks(ctx.workspaceId, "deal.created", {
        id: created.id,
        title: v.title,
        amount: parseAmount(v.amount),
      }),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "STAGE_NOT_FOUND") return { error: "Selected stage was not found." };
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") return { error: "Selected company was not found." };
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    console.error("createDeal failed", e);
    return { error: "Could not save the deal." };
  }

  revalidatePath("/app/deals");
  redirect("/app/deals");
}

export async function updateDeal(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readDeal(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  let change: { stageName: string; stageChanged: boolean; fromStatus: DealStatus; toStatus: DealStatus } | null = null;
  try {
    change = await withTenant(ctx.workspaceId, async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { id: v.stageId, pipelineId: v.pipelineId },
      });
      if (!stage) throw new Error("STAGE_NOT_FOUND");
      if (v.companyId) {
        const company = await tx.company.findFirst({ where: { id: v.companyId, deletedAt: null } });
        if (!company) throw new Error("COMPANY_NOT_FOUND");
      }
      const existing = await tx.deal.findFirst({ where: { id }, select: { customFields: true, stageId: true, status: true } });
      const fieldDefs = await listFields(tx, "deal");
      const cf = readValues(fieldDefs, formData, false);
      const missing = missingRequired(fieldDefs, cf);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      const merged = { ...((existing?.customFields as Record<string, unknown>) ?? {}), ...cf };
      const toStatus = statusForStage[stage.stageType];
      await tx.deal.update({
        where: { id },
        data: {
          title: v.title,
          amount: parseAmount(v.amount),
          currency: (v.currency || "USD").toUpperCase(),
          pipelineId: v.pipelineId,
          stageId: v.stageId,
          status: toStatus,
          companyId: v.companyId || null,
          expectedCloseAt: v.expectedCloseAt ? new Date(v.expectedCloseAt) : null,
          customFields: merged as Prisma.InputJsonValue,
          updatedById: ctx.userId,
        },
      });
      await syncDealContacts(tx, ctx.workspaceId, id, formData.getAll("contactIds").map(String).filter(Boolean));
      return { stageName: stage.name, stageChanged: existing?.stageId !== v.stageId, fromStatus: existing?.status ?? toStatus, toStatus };
    });
    const c = change;
    after(() => runWorkflows(ctx.workspaceId, "deal_updated", { dealId: id, recordName: v.title, actorId: ctx.userId }).catch(() => {}));
    if (c.stageChanged) {
      after(() => runWorkflows(ctx.workspaceId, "deal_stage_changed", { dealId: id, stageName: c.stageName, actorId: ctx.userId }).catch(() => {}));
    }
    if (c.fromStatus !== c.toStatus) {
      after(() =>
        runWorkflows(ctx.workspaceId, "deal_status_changed", { dealId: id, fromStatus: c.fromStatus, toStatus: c.toStatus, status: c.toStatus, actorId: ctx.userId }).catch(() => {}),
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message === "STAGE_NOT_FOUND") return { error: "Selected stage was not found." };
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") return { error: "Selected company was not found." };
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    console.error("updateDeal failed", e);
    return { error: "Could not update the deal." };
  }

  revalidatePath("/app/deals");
  redirect("/app/deals");
}

/** Moves a deal to a stage (used by the board); status follows the stage type. */
export async function moveDeal(dealId: string, stageId: string): Promise<void> {
  const ctx = await requireAuth();
  const moved = await withTenant(ctx.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId } });
    if (!stage) throw new Error("STAGE_NOT_FOUND");
    const existing = await tx.deal.findFirst({ where: { id: dealId }, select: { status: true } });
    const toStatus = statusForStage[stage.stageType];
    await tx.deal.update({
      where: { id: dealId },
      data: { stageId, pipelineId: stage.pipelineId, status: toStatus },
    });
    await logEventTx(tx, ctx.workspaceId, "DEAL", dealId, "stage_changed", `Moved to ${stage.name}`, ctx.userId);
    return { stageName: stage.name, fromStatus: existing?.status ?? toStatus, toStatus };
  });
  after(() =>
    runWorkflows(ctx.workspaceId, "deal_stage_changed", { dealId, stageName: moved.stageName, actorId: ctx.userId }).catch((e) =>
      console.error("deal_stage_changed workflow failed", e),
    ),
  );
  if (moved.fromStatus !== moved.toStatus) {
    after(() =>
      runWorkflows(ctx.workspaceId, "deal_status_changed", {
        dealId,
        fromStatus: moved.fromStatus,
        toStatus: moved.toStatus,
        status: moved.toStatus,
        actorId: ctx.userId,
      }).catch(() => {}),
    );
  }
  after(() => dispatchWebhooks(ctx.workspaceId, "deal.stage_changed", { id: dealId, stageName: moved.stageName }));
  revalidatePath("/app/deals");
}

/** Form-action wrapper for the board's per-card stage selector. */
export async function moveDealAction(formData: FormData): Promise<void> {
  const dealId = String(formData.get("dealId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  if (!dealId || !stageId) return;
  await moveDeal(dealId, stageId);
}

export async function bulkDeleteDeals(ids: string[]): Promise<void> {
  const ctx = await requireAuth();
  const clean = ids.filter(Boolean).slice(0, 500);
  if (clean.length === 0) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.deal.updateMany({ where: { id: { in: clean } }, data: { deletedAt: new Date() } }),
  );
  after(() =>
    Promise.all(clean.map((id) => runWorkflows(ctx.workspaceId, "deal_deleted", { dealId: id, actorId: ctx.userId }))).catch(() => {}),
  );
  revalidatePath("/app/deals");
}

export async function deleteDeal(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.deal.update({ where: { id }, data: { deletedAt: new Date() } });
    await cleanupAssociations(tx, "deal", id);
  });
  after(() => runWorkflows(ctx.workspaceId, "deal_deleted", { dealId: id, actorId: ctx.userId }).catch(() => {}));
  revalidatePath("/app/deals");
  redirect("/app/deals");
}
