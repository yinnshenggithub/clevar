export const FIELD_TYPES = [
  "text",
  "number",
  "currency",
  "rating",
  "boolean",
  "date",
  "select",
  "multi_select",
  "url",
  "email",
  "phone",
  "rich_text",
  "relation",
  "relations",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  rating: "Rating (1–5)",
  boolean: "Checkbox",
  date: "Date",
  select: "Select — single choice",
  multi_select: "Multi-select — many choices",
  url: "URL",
  email: "Email",
  phone: "Phone",
  rich_text: "Long text",
  relation: "Relation — single link (one-to-many)",
  relations: "Relations — many links (many-to-many)",
};

/** True for both single (`relation`) and multi (`relations`) link types. */
export function isRelationType(type: string): boolean {
  return type === "relation" || type === "relations";
}

/** Field types whose options carry a fixed list of `choices`. */
export function hasChoices(type: string): boolean {
  return type === "select" || type === "multi_select";
}

/** Field types that store/return an array of values. */
export function isMultiValue(type: string): boolean {
  return type === "relations" || type === "multi_select";
}

/** Field types that accept a scalar default value. */
export function supportsDefault(type: string): boolean {
  return !isRelationType(type) && type !== "boolean" && type !== "multi_select";
}

/** Display formatting for a scalar field value (relations handled separately by the caller). */
export function formatFieldValue(type: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (type === "boolean") return value === true ? "Yes" : "No";
  if (type === "currency") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }
  if (type === "rating") {
    const n = Math.max(0, Math.min(5, Math.round(Number(value))));
    return "★".repeat(n) + "☆".repeat(5 - n);
  }
  if (type === "multi_select") {
    const arr = Array.isArray(value) ? value : [];
    return arr.length ? arr.map(String).join(", ") : "—";
  }
  return String(value);
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
