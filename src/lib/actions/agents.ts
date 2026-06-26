"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { DEFAULT_MODEL } from "@/lib/ai-models";

export interface FormState {
  error?: string;
}

const agentSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(120),
  instructions: z.string().max(8000).optional(),
  model: z.string().min(1).max(80).optional(),
  mode: z.enum(["support", "sales", "custom"]).optional(),
  tone: z.string().max(40).optional(),
  responseStyle: z.enum(["concise", "balanced", "detailed"]).optional(),
  objectives: z.string().max(4000).optional(),
  constraints: z.string().max(4000).optional(),
  greeting: z.string().max(500).optional(),
  temperature: z.coerce.number().min(0).max(1).optional(),
  handoffEnabled: z.boolean().optional(),
  handoffUserId: z.string().uuid().optional().or(z.literal("")),
});

interface RuleInput {
  label?: string;
  trigger: string;
  keywords?: string;
  action: string;
  note?: string;
}

function parseRules(raw: FormDataEntryValue | null): RuleInput[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => ({
        label: String(r?.label ?? "").slice(0, 60),
        trigger: ["keyword", "asks_human"].includes(r?.trigger) ? r.trigger : "keyword",
        keywords: String(r?.keywords ?? "").slice(0, 400),
        action: ["handoff", "note"].includes(r?.action) ? r.action : "handoff",
        note: String(r?.note ?? "").slice(0, 400),
      }))
      .filter((r) => (r.trigger === "asks_human" ? true : Boolean(r.keywords)))
      .slice(0, 25);
  } catch {
    return [];
  }
}

function readAgent(formData: FormData) {
  return agentSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    model: formData.get("model") || undefined,
    mode: formData.get("mode") || undefined,
    tone: formData.get("tone") || undefined,
    responseStyle: formData.get("responseStyle") || undefined,
    objectives: formData.get("objectives") || undefined,
    constraints: formData.get("constraints") || undefined,
    greeting: formData.get("greeting") || undefined,
    temperature: formData.get("temperature") || undefined,
    handoffEnabled: formData.get("handoffEnabled") === "on",
    handoffUserId: formData.get("handoffUserId") || "",
  });
}

function agentData(v: z.infer<typeof agentSchema>, rules: RuleInput[]) {
  return {
    name: v.name,
    instructions: v.instructions || "",
    model: v.model || DEFAULT_MODEL,
    mode: v.mode || "support",
    tone: v.tone || "friendly",
    responseStyle: v.responseStyle || "balanced",
    objectives: v.objectives || "",
    constraints: v.constraints || "",
    greeting: v.greeting || "",
    temperature: v.temperature ?? 0.5,
    handoffEnabled: v.handoffEnabled ?? true,
    handoffUserId: v.handoffUserId || null,
    rules: rules as object[],
  };
}

export async function createAgent(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readAgent(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const rules = parseRules(formData.get("rules"));
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.create({ data: { workspaceId: ctx.workspaceId, ...agentData(v, rules) } });
    });
  } catch (e) {
    console.error("createAgent failed", e);
    return { error: "Could not create the agent." };
  }
  revalidatePath("/app/agents");
  redirect("/app/agents");
}

export async function updateAgent(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readAgent(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const rules = parseRules(formData.get("rules"));
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.update({ where: { id }, data: agentData(v, rules) });
    });
  } catch (e) {
    console.error("updateAgent failed", e);
    return { error: "Could not update the agent." };
  }
  revalidatePath("/app/agents");
  revalidatePath(`/app/agents/${id}`);
  redirect(`/app/agents/${id}`);
}

export async function deleteAgent(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.aiAgent.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  revalidatePath("/app/agents");
  redirect("/app/agents");
}

/** Creates a fresh conversation for an agent and opens it. */
export async function newConversation(agentId: string): Promise<void> {
  const ctx = await requireAuth();
  let conversationId = "";
  await withTenant(ctx.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    const convo = await tx.aiConversation.create({
      data: { workspaceId: ctx.workspaceId, agentId },
    });
    conversationId = convo.id;
  });
  redirect(`/app/agents/${agentId}/chat?c=${conversationId}`);
}
