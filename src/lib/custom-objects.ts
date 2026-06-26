export const FIELD_TYPES = ["text", "number", "boolean", "date", "select", "relation", "relations"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Checkbox",
  date: "Date",
  select: "Select",
  relation: "Relation — single link (one-to-many)",
  relations: "Relations — many links (many-to-many)",
};

/** True for both single (`relation`) and multi (`relations`) link types. */
export function isRelationType(type: string): boolean {
  return type === "relation" || type === "relations";
}

export const CORE_RELATION_TARGETS = [
  { value: "contact", label: "Contact" },
  { value: "company", label: "Company" },
  { value: "deal", label: "Deal" },
];

export interface FieldDefLite {
  key: string;
  label: string;
  type: string;
  options: unknown;
}

/** Best-effort display title for a custom record from its values. */
export function recordTitle(fields: FieldDefLite[], values: Record<string, unknown>): string {
  const firstText = fields.find((f) => f.type === "text" && values[f.key]);
  if (firstText) return String(values[firstText.key]);
  const firstAny = fields.find((f) => values[f.key] != null && values[f.key] !== "");
  if (firstAny) return String(values[firstAny.key]);
  return "Untitled";
}

export function relationTarget(options: unknown): string | null {
  if (options && typeof options === "object" && "target" in options) {
    return String((options as Record<string, unknown>).target ?? "") || null;
  }
  return null;
}

export function selectChoices(options: unknown): string[] {
  if (options && typeof options === "object" && "choices" in options) {
    const c = (options as Record<string, unknown>).choices;
    return Array.isArray(c) ? c.map(String) : [];
  }
  return [];
}
