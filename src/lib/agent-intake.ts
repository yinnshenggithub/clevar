import "server-only";
import { loadPropertyCatalog, readProperty, type PropertyEntry } from "./agent-properties";
import type { IntakeField } from "./agent-prompt";

/**
 * Deterministic intake gate. Required fields hard-block: while any is empty the
 * turn runs in collection mode — retrieved knowledge is withheld (so the model
 * can't answer product questions) and an imperative directive names the next
 * item to collect. Optional fields are asked but never block, and declines are
 * handled gracefully so the agent never deadlocks.
 */

export interface IntakeItem {
  qualified: string;
  label: string;
  required: boolean;
}

export interface IntakeState {
  active: boolean; // some REQUIRED field still missing
  collected: IntakeItem[];
  requiredMissing: IntakeItem[];
  optionalMissing: IntakeItem[];
}

const INACTIVE: IntakeState = { active: false, collected: [], requiredMissing: [], optionalMissing: [] };

/** Accept legacy string[] or the current {key,required}[] shape. */
export function normalizeIntake(raw: unknown): IntakeField[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeField[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) out.push({ key: x.trim(), required: true });
    else if (x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string") {
      const key = (x as { key: string }).key.trim();
      if (key) out.push({ key, required: (x as { required?: unknown }).required !== false });
    }
  }
  return out;
}

/**
 * Which fields are set vs missing for the conversation's contact. With no
 * contact (studio tester) every field reads missing, so the tester shows the
 * full collection flow.
 */
export async function computeIntake(
  workspaceId: string,
  contactId: string | null | undefined,
  fields: IntakeField[],
): Promise<IntakeState> {
  if (!fields.length) return INACTIVE;

  const catalog = await loadPropertyCatalog(workspaceId);
  const byQualified = new Map<string, PropertyEntry>(catalog.map((e) => [e.qualified, e]));

  const collected: IntakeItem[] = [];
  const requiredMissing: IntakeItem[] = [];
  const optionalMissing: IntakeItem[] = [];

  for (const f of fields) {
    const entry = byQualified.get(f.key);
    if (!entry) continue; // stale/unknown key — ignore rather than block forever
    const item: IntakeItem = { qualified: f.key, label: entry.label, required: f.required };
    let filled = false;
    if (contactId) {
      const res = await readProperty(workspaceId, { catalog, contactId, property: f.key });
      filled = res.ok && / = /.test(res.message) && !/ = —$/.test(res.message);
    }
    if (filled) collected.push(item);
    else if (f.required) requiredMissing.push(item);
    else optionalMissing.push(item);
  }

  return { active: requiredMissing.length > 0, collected, requiredMissing, optionalMissing };
}

/** The imperative collection-mode block appended last (highest priority) to the turn. */
export function intakeDirective(state: IntakeState): string {
  const next = state.requiredMissing[0];
  const have = state.collected.map((c) => c.label).join(", ") || "nothing yet";
  const required = state.requiredMissing.map((m) => `${m.label} (${m.qualified})`).join(", ") || "none";
  const optional = state.optionalMissing.map((m) => `${m.label} (${m.qualified})`).join(", ") || "none";
  return [
    "<collection_mode>",
    "You are gathering required details before you can help. Do NOT answer other questions, give pricing, product details, or suggestions until every REQUIRED item is collected.",
    `Already collected: ${have}.`,
    `Required (must collect, these block progress): ${required}.`,
    `Optional (ask once if natural, but NEVER block and NEVER re-ask if declined): ${optional}.`,
    "When the customer provides any value, immediately call set_property with the exact object.key to store it.",
    next
      ? `This turn: ask ONLY for the next required item — ${next.label} (${next.qualified}) — briefly and warmly, one item at a time.`
      : "This turn: continue naturally.",
    "If the customer declines or resists a REQUIRED item, don't nag: explain in one line why it's needed, and if they still refuse, offer to connect a human teammate instead of looping.",
    "</collection_mode>",
  ].join("\n");
}

/**
 * Soft ask: no required items are pending, so the agent answers normally but is
 * nudged to gather the still-missing optional details lightly — one at a time,
 * never insisting, dropping any the customer declines.
 */
export function intakeSoftDirective(state: IntakeState): string {
  const optional = state.optionalMissing.map((m) => `${m.label} (${m.qualified})`).join(", ");
  return [
    "<collect_when_natural>",
    "Answer the customer normally. Separately, when it fits the flow, try to gather these details — but this is low priority and must never feel pushy:",
    optional,
    "Ask for at most ONE of them per reply, keep it casual, and if the customer ignores or declines it, drop it — do not re-ask or insist. When they give a value, call set_property with the exact object.key.",
    "</collect_when_natural>",
  ].join("\n");
}
