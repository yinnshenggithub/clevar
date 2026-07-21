"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { ACTION_DEFS } from "@/lib/agent-action-defs";

const LIVE_ACTION_KEYS = new Set(ACTION_DEFS.filter((d) => !d.premium).map((d) => d.key));

function parseActions(raw: FormDataEntryValue | null): Record<string, { enabled: boolean; guideline: string }> {
  try {
    const obj = JSON.parse(String(raw ?? "{}"));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, { enabled: boolean; guideline: string }> = {};
    for (const def of ACTION_DEFS) {
      const v = obj[def.key];
      if (!v || typeof v !== "object") continue;
      out[def.key] = {
        enabled: Boolean(v.enabled) && LIVE_ACTION_KEYS.has(def.key),
        guideline: String(v.guideline ?? "").slice(0, 1000),
      };
    }
    return out;
  } catch {
    return {};
  }
}

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
  grounding: z.enum(["strict", "flexible", "open"]).optional(),
  refusalLine: z.string().max(200).optional(),
  languagePolicy: z.string().max(60).optional(),
  handoffMessage: z.string().max(300).optional(),
});

/** Parses a JSON string[] hidden field (do's / don'ts). */
function parseStringList(raw: FormDataEntryValue | null, maxItems: number, maxLen: number): string[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => String(s ?? "").trim().slice(0, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

/** Parses a JSON array of two-string objects (playbook / examples). */
function parsePairs(raw: FormDataEntryValue | null, keyA: string, keyB: string, maxItems: number): object[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => ({
        [keyA]: String(p?.[keyA] ?? "").trim().slice(0, 400),
        [keyB]: String(p?.[keyB] ?? "").trim().slice(0, 800),
      }))
      .filter((p) => p[keyA] && p[keyB])
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

/** Parses the intake list: ordered {key, required} entries (accepts legacy strings). */
function parseIntakeFields(raw: FormDataEntryValue | null, maxItems = 30): { key: string; required: boolean }[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    const out: { key: string; required: boolean }[] = [];
    for (const x of arr) {
      if (typeof x === "string") {
        const key = x.trim().slice(0, 100);
        if (key) out.push({ key, required: true });
      } else if (x && typeof x === "object" && typeof x.key === "string") {
        const key = x.key.trim().slice(0, 100);
        if (key) out.push({ key, required: x.required !== false });
      }
    }
    return out.slice(0, maxItems);
  } catch {
    return [];
  }
}

const PROFILE_FIELD_KEYS = new Set(["name", "company", "email", "phone", "tags", "openDeals"]);

function parseProfileFields(raw: FormDataEntryValue | null): string[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.map(String).filter((f) => PROFILE_FIELD_KEYS.has(f));
  } catch {
    return [];
  }
}

function parseHandoffTriggers(raw: FormDataEntryValue | null): object {
  try {
    const obj = JSON.parse(String(raw ?? "{}"));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, unknown> = { askHuman: obj.askHuman !== false };
    const n = Number(obj.cantAnswer);
    if (Number.isInteger(n) && n >= 1 && n <= 10) out.cantAnswer = n;
    const h = obj.hours;
    if (h && typeof h === "object" && h.enabled) {
      const days = Array.isArray(h.days) ? h.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : [];
      const hm = (v: unknown) => (/^\d{1,2}:\d{2}$/.test(String(v ?? "")) ? String(v) : null);
      const start = hm(h.start);
      const end = hm(h.end);
      if (days.length && start && end) {
        out.hours = {
          enabled: true,
          days,
          start,
          end,
          tz: String(h.tz ?? "UTC").slice(0, 60),
          message: String(h.message ?? "").slice(0, 300) || undefined,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

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
    grounding: formData.get("grounding") || undefined,
    refusalLine: formData.get("refusalLine") || undefined,
    languagePolicy: formData.get("languagePolicy") || undefined,
    handoffMessage: formData.get("handoffMessage") || undefined,
  });
}

function agentData(
  v: z.infer<typeof agentSchema>,
  formData: FormData,
  rules: RuleInput[],
  actions: Record<string, { enabled: boolean; guideline: string }>,
) {
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
    actions: actions as object,
    grounding: v.grounding || "strict",
    refusalLine: v.refusalLine?.trim() || null,
    languagePolicy: v.languagePolicy || "mirror",
    handoffMessage: v.handoffMessage?.trim() || null,
    dos: parseStringList(formData.get("dos"), 20, 200),
    donts: parseStringList(formData.get("donts"), 20, 200),
    playbook: parsePairs(formData.get("playbook"), "scenario", "response", 15),
    examples: parsePairs(formData.get("examples"), "user", "assistant", 8),
    profileFields: parseProfileFields(formData.get("profileFields")),
    intakeFields: parseIntakeFields(formData.get("intakeFields")),
    handoffTriggers: parseHandoffTriggers(formData.get("handoffTriggers")),
  };
}

export async function createAgent(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readAgent(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const rules = parseRules(formData.get("rules"));
  const actions = parseActions(formData.get("actions"));
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.create({ data: { workspaceId: ctx.workspaceId, ...agentData(v, formData, rules, actions) } });
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
  const actions = parseActions(formData.get("actions"));
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.aiAgent.update({ where: { id }, data: agentData(v, formData, rules, actions) });
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
