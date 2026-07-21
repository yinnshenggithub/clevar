import "server-only";
import { loadPropertyCatalog, readProperty, type PropertyEntry } from "./agent-properties";

/**
 * Deterministic intake gate. When an agent has required intake fields, it must
 * collect them before answering anything else. Adherence is NOT left to the
 * model: while any field is still empty we (a) suppress retrieved knowledge so
 * the model has nothing to answer product questions from, and (b) inject an
 * imperative turn directive naming the next field to collect. Only once every
 * field is filled does normal answering unlock.
 */

export interface IntakeState {
  active: boolean;
  collected: { qualified: string; label: string }[];
  missing: { qualified: string; label: string }[];
}

const INACTIVE: IntakeState = { active: false, collected: [], missing: [] };

/**
 * Which required fields are already set for the conversation's contact and which
 * are still missing. With no contact (studio tester) every field reads missing,
 * so the tester demonstrates the full collection flow.
 */
export async function computeIntake(
  workspaceId: string,
  contactId: string | null | undefined,
  intakeFields: string[],
): Promise<IntakeState> {
  const wanted = intakeFields.map((s) => s.trim()).filter(Boolean);
  if (!wanted.length) return INACTIVE;

  const catalog = await loadPropertyCatalog(workspaceId);
  const byQualified = new Map<string, PropertyEntry>(catalog.map((e) => [e.qualified, e]));

  const collected: IntakeState["collected"] = [];
  const missing: IntakeState["missing"] = [];
  for (const qualified of wanted) {
    const entry = byQualified.get(qualified);
    const label = entry?.label ?? qualified;
    if (!entry) continue; // stale/unknown key — ignore rather than block forever
    let filled = false;
    if (contactId) {
      const res = await readProperty(workspaceId, { catalog, contactId, property: qualified });
      // readProperty returns "<qualified> = <value>" when set; "not set" when empty.
      filled = res.ok && / = /.test(res.message) && !/ = —$/.test(res.message);
    }
    (filled ? collected : missing).push({ qualified, label });
  }

  return { active: missing.length > 0, collected, missing };
}

/** The imperative collection-mode block appended (last = highest priority) to the turn. */
export function intakeDirective(state: IntakeState): string {
  const next = state.missing[0];
  const have = state.collected.map((c) => c.label).join(", ") || "nothing yet";
  const need = state.missing.map((m) => `${m.label} (${m.qualified})`).join(", ");
  return [
    "<collection_mode>",
    "You are still gathering required information and MUST NOT answer other questions, give product details, or make suggestions yet.",
    `Already collected: ${have}.`,
    `Still required: ${need}.`,
    `This turn: if the customer just provided any required value, call set_property to store it (use the exact object.key). Then ask ONLY for the next missing item: ${next ? `${next.label} (${next.qualified})` : "—"}.`,
    "Ask for one item at a time, briefly and naturally. Do not proceed to help until every required item is collected.",
    "</collection_mode>",
  ].join("\n");
}
