"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { isTrigger, isAction } from "@/lib/workflow";

export interface FormState {
  error?: string;
}

interface RawStep {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
  condition?: unknown;
  branches?: { yes?: RawStep[]; no?: RawStep[]; buckets?: RawStep[][] };
  weights?: number[];
  agentId?: string | null;
  text?: string | null;
}

const MAX_NODES = 200;

/** Recursively validate + sanitize the step tree, returning the cleaned list or throwing. */
function sanitizeSteps(input: unknown, budget: { n: number }): RawStep[] {
  if (!Array.isArray(input)) return [];
  const out: RawStep[] = [];
  for (const raw of input) {
    if (budget.n++ > MAX_NODES) throw new Error("TOO_MANY_STEPS");
    const o = (raw ?? {}) as Record<string, unknown>;
    const type = String(o.type ?? "");
    if (!isAction(type)) throw new Error(`UNKNOWN_STEP:${type}`);
    const step: RawStep = { type };
    if (typeof o.id === "string") step.id = o.id;
    if (o.config && typeof o.config === "object") step.config = o.config as Record<string, unknown>;
    if (o.condition && typeof o.condition === "object") step.condition = o.condition;
    if (Array.isArray(o.weights)) step.weights = (o.weights as unknown[]).map(Number).filter((n) => Number.isFinite(n));
    if (typeof o.agentId === "string") step.agentId = o.agentId;
    if (typeof o.text === "string") step.text = o.text;
    const b = o.branches as RawStep["branches"] | undefined;
    if (b && typeof b === "object") {
      step.branches = {};
      if (b.yes) step.branches.yes = sanitizeSteps(b.yes, budget);
      if (b.no) step.branches.no = sanitizeSteps(b.no, budget);
      if (Array.isArray(b.buckets)) step.branches.buckets = b.buckets.map((bk) => sanitizeSteps(bk, budget));
    }
    out.push(step);
  }
  return out;
}

interface Parsed {
  name: string;
  enabled: boolean;
  triggerType: string;
  conditionField: string | null;
  conditionOp: string | null;
  conditionValue: string | null;
  steps: RawStep[];
}

function read(formData: FormData): { ok: true; data: Parsed } | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > 120) return { ok: false, error: "Name is too long" };

  const triggerType = String(formData.get("triggerType") ?? "");
  if (!isTrigger(triggerType)) return { ok: false, error: "Pick a valid trigger" };

  let rawSteps: unknown = [];
  try {
    rawSteps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    return { ok: false, error: "Invalid steps" };
  }
  let steps: RawStep[];
  try {
    steps = sanitizeSteps(rawSteps, { n: 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TOO_MANY_STEPS") return { ok: false, error: "Too many steps (max 200)." };
    if (msg.startsWith("UNKNOWN_STEP:")) return { ok: false, error: `Unknown action: ${msg.slice("UNKNOWN_STEP:".length)}` };
    return { ok: false, error: "Invalid steps" };
  }
  if (steps.length === 0) return { ok: false, error: "Add at least one action" };

  const conditionField = String(formData.get("conditionField") ?? "").trim() || null;
  const conditionValue = String(formData.get("conditionValue") ?? "").trim() || null;
  const conditionOpRaw = String(formData.get("conditionOp") ?? "").trim();
  const hasCondition = Boolean(conditionField && conditionValue);

  return {
    ok: true,
    data: {
      name,
      enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
      triggerType,
      conditionField: hasCondition ? conditionField : null,
      conditionOp: hasCondition ? (conditionOpRaw === "equals" ? "equals" : "contains") : null,
      conditionValue: hasCondition ? conditionValue : null,
      steps,
    },
  };
}

function fields(v: Parsed) {
  const first = v.steps[0];
  const firstConfig = (first?.config ?? {}) as Record<string, unknown>;
  return {
    name: v.name,
    enabled: v.enabled,
    triggerType: v.triggerType,
    conditionField: v.conditionField,
    conditionOp: v.conditionOp,
    conditionValue: v.conditionValue,
    steps: v.steps as unknown as object,
    // legacy single-action columns, kept for list display + back-compat reads
    actionType: first?.type ?? "add_note",
    actionAgentId: (firstConfig.agentId as string) ?? first?.agentId ?? null,
    actionText: (firstConfig.text as string) ?? first?.text ?? null,
  };
}

export async function createWorkflow(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = read(formData);
  if (!parsed.ok) return { error: parsed.error };
  try {
    await withTenant(ctx.workspaceId, (tx) => tx.workflow.create({ data: { workspaceId: ctx.workspaceId, ...fields(parsed.data) } }));
  } catch (e) {
    console.error("createWorkflow failed", e);
    return { error: "Could not save the workflow." };
  }
  revalidatePath("/app/workflows");
  redirect("/app/workflows");
}

export async function updateWorkflow(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = read(formData);
  if (!parsed.ok) return { error: parsed.error };
  try {
    await withTenant(ctx.workspaceId, (tx) => tx.workflow.update({ where: { id }, data: fields(parsed.data) }));
  } catch (e) {
    console.error("updateWorkflow failed", e);
    return { error: "Could not update the workflow." };
  }
  revalidatePath("/app/workflows");
  redirect("/app/workflows");
}

export async function deleteWorkflow(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.workflow.delete({ where: { id } }));
  revalidatePath("/app/workflows");
  redirect("/app/workflows");
}

export async function toggleWorkflow(id: string, enabled: boolean): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.workflow.update({ where: { id }, data: { enabled } }));
  revalidatePath("/app/workflows");
}
