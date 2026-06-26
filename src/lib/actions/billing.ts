"use server";

import { revalidatePath } from "next/cache";
import type { WorkspacePlan } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/plans";

export interface PlanState {
  error?: string;
  ok?: boolean;
}

export async function setPlan(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const ctx = await requireAuth();
  if (ctx.role !== "OWNER") return { error: "Only the workspace owner can change the plan." };

  const plan = String(formData.get("plan") ?? "");
  if (!["FREE", "PRO", "BUSINESS"].includes(plan)) return { error: "Invalid plan." };
  const p = plan as WorkspacePlan;

  try {
    await prisma.workspace.update({ where: { id: ctx.workspaceId }, data: { plan: p } });
    await withTenant(ctx.workspaceId, async (tx) => {
      const existing = await tx.workspaceCredits.findUnique({ where: { workspaceId: ctx.workspaceId } });
      if (existing) {
        await tx.workspaceCredits.update({
          where: { workspaceId: ctx.workspaceId },
          data: { monthlyLimit: PLAN_LIMITS[p] },
        });
      } else {
        await tx.workspaceCredits.create({ data: { workspaceId: ctx.workspaceId, monthlyLimit: PLAN_LIMITS[p] } });
      }
    });
  } catch (e) {
    console.error("setPlan failed", e);
    return { error: "Could not change the plan." };
  }
  revalidatePath("/app/settings");
  return { ok: true };
}
