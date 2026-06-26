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

const schema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  enabled: z.boolean(),
  triggerType: z.enum(TRIGGERS),
  conditionField: z.string().max(40).optional(),
  conditionOp: z.enum(["contains", "equals"]).optional(),
  conditionValue: z.string().max(500).optional(),
  actionType: z.enum(ACTIONS),
  actionAgentId: z.string().uuid().optional().or(z.literal("")),
  actionText: z.string().max(2000).optional(),
});

function read(formData: FormData) {
  return schema.safeParse({
    name: formData.get("name"),
    enabled: formData.get("enabled") === "on",
    triggerType: formData.get("triggerType"),
    conditionField: formData.get("conditionField") || undefined,
    conditionOp: (formData.get("conditionOp") as string) || undefined,
    conditionValue: formData.get("conditionValue") || undefined,
    actionType: formData.get("actionType"),
    actionAgentId: formData.get("actionAgentId") || "",
    actionText: formData.get("actionText") || undefined,
  });
}

function validateAction(v: z.infer<typeof schema>): string | null {
  if (v.actionType === "assign_agent" && !v.actionAgentId) return "Choose an AI agent for the assign action.";
  if ((v.actionType === "send_reply" || v.actionType === "add_note") && !v.actionText?.trim())
    return "Enter the text for the action.";
  return null;
}

function fields(v: z.infer<typeof schema>) {
  const hasCondition = Boolean(v.conditionField && v.conditionValue);
  return {
    name: v.name,
    enabled: v.enabled,
    triggerType: v.triggerType,
    conditionField: hasCondition ? v.conditionField! : null,
    conditionOp: hasCondition ? v.conditionOp ?? "contains" : null,
    conditionValue: hasCondition ? v.conditionValue! : null,
    actionType: v.actionType,
    actionAgentId: v.actionType === "assign_agent" ? v.actionAgentId || null : null,
    actionText: v.actionType === "assign_agent" ? null : v.actionText?.trim() || null,
  };
}

export async function createWorkflow(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const err = validateAction(parsed.data);
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
  const err = validateAction(parsed.data);
  if (err) return { error: err };
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.workflow.update({ where: { id }, data: fields(parsed.data) }),
    );
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
