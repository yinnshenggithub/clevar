"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";

export interface FormState {
  error?: string;
}

const TRIGGERS = ["message_received", "contact_created", "deal_created", "deal_stage_changed"] as const;
const ACTIONS = ["assign_agent", "send_reply", "add_note"] as const;

const stepSchema = z.object({
  type: z.enum(ACTIONS),
  agentId: z.string().uuid().optional().or(z.literal("")),
  text: z.string().max(2000).optional(),
});

const schema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  enabled: z.boolean(),
  triggerType: z.enum(TRIGGERS),
  conditionField: z.string().max(40).optional(),
  conditionOp: z.enum(["contains", "equals"]).optional(),
  conditionValue: z.string().max(500).optional(),
  steps: z.array(stepSchema).min(1, "Add at least one action"),
});

type Parsed = z.infer<typeof schema>;

function read(formData: FormData) {
  let steps: unknown = [];
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    steps = [];
  }
  return schema.safeParse({
    name: formData.get("name"),
    enabled: formData.get("enabled") === "on",
    triggerType: formData.get("triggerType"),
    conditionField: formData.get("conditionField") || undefined,
    conditionOp: (formData.get("conditionOp") as string) || undefined,
    conditionValue: formData.get("conditionValue") || undefined,
    steps,
  });
}

function validateSteps(v: Parsed): string | null {
  for (const s of v.steps) {
    if (s.type === "assign_agent" && !s.agentId) return "Each 'assign agent' step needs an agent.";
    if ((s.type === "send_reply" || s.type === "add_note") && !s.text?.trim())
      return "Each reply/note step needs text.";
  }
  return null;
}

function fields(v: Parsed) {
  const hasCondition = Boolean(v.conditionField && v.conditionValue);
  const first = v.steps[0];
  return {
    name: v.name,
    enabled: v.enabled,
    triggerType: v.triggerType,
    conditionField: hasCondition ? v.conditionField! : null,
    conditionOp: hasCondition ? v.conditionOp ?? "contains" : null,
    conditionValue: hasCondition ? v.conditionValue! : null,
    steps: v.steps.map((s) => ({
      type: s.type,
      agentId: s.type === "assign_agent" ? s.agentId || null : null,
      text: s.type === "assign_agent" ? null : s.text?.trim() || null,
    })),
    // legacy single-action columns kept in sync for back-compat / list display
    actionType: first.type,
    actionAgentId: first.type === "assign_agent" ? first.agentId || null : null,
    actionText: first.type === "assign_agent" ? null : first.text?.trim() || null,
  };
}

export async function createWorkflow(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const err = validateSteps(parsed.data);
  if (err) return { error: err };
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.workflow.create({ data: { workspaceId: ctx.workspaceId, ...fields(parsed.data) } }),
    );
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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const err = validateSteps(parsed.data);
  if (err) return { error: err };
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
