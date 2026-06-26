import type { WorkspacePlan } from "@prisma/client";

export const PLANS: WorkspacePlan[] = ["FREE", "PRO", "BUSINESS"];

export const PLAN_LIMITS: Record<WorkspacePlan, number> = {
  FREE: 1000,
  PRO: 10000,
  BUSINESS: 50000,
};

export const PLAN_LABELS: Record<WorkspacePlan, string> = {
  FREE: "Free",
  PRO: "Pro",
  BUSINESS: "Business",
};
