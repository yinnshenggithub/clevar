"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { StageType, DealStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
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

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { id: v.stageId, pipelineId: v.pipelineId },
      });
      if (!stage) throw new Error("STAGE_NOT_FOUND");
      if (v.companyId) {
        const company = await tx.company.findFirst({ where: { id: v.companyId, deletedAt: null } });
        if (!company) throw new Error("COMPANY_NOT_FOUND");
      }
      await tx.deal.update({
        where: { id },
        data: {
          title: v.title,
          amount: parseAmount(v.amount),
          currency: (v.currency || "USD").toUpperCase(),
          pipelineId: v.pipelineId,
          stageId: v.stageId,
          status: statusForStage[stage.stageType],
          companyId: v.companyId || null,
          expectedCloseAt: v.expectedCloseAt ? new Date(v.expectedCloseAt) : null,
          updatedById: ctx.userId,
        },
      });
      await syncDealContacts(tx, ctx.workspaceId, id, formData.getAll("contactIds").map(String).filter(Boolean));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "STAGE_NOT_FOUND") return { error: "Selected stage was not found." };
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") return { error: "Selected company was not found." };
    console.error("updateDeal failed", e);
    return { error: "Could not update the deal." };
  }

  revalidatePath("/app/deals");
  redirect("/app/deals");
}

/** Moves a deal to a stage (used by the board); status follows the stage type. */
export async function moveDeal(dealId: string, stageId: string): Promise<void> {
  const ctx = await requireAuth();
  const stageName = await withTenant(ctx.workspaceId, async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId } });
    if (!stage) throw new Error("STAGE_NOT_FOUND");
    await tx.deal.update({
      where: { id: dealId },
      data: { stageId, pipelineId: stage.pipelineId, status: statusForStage[stage.stageType] },
    });
    await logEventTx(tx, ctx.workspaceId, "DEAL", dealId, "stage_changed", `Moved to ${stage.name}`, ctx.userId);
    return stage.name;
  });
  after(() =>
    runWorkflows(ctx.workspaceId, "deal_stage_changed", { dealId, stageName }).catch((e) =>
      console.error("deal_stage_changed workflow failed", e),
    ),
  );
  after(() => dispatchWebhooks(ctx.workspaceId, "deal.stage_changed", { id: dealId, stageName }));
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
  revalidatePath("/app/deals");
}

export async function deleteDeal(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  revalidatePath("/app/deals");
  redirect("/app/deals");
}
