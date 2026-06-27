import { isMultiValue } from "./custom-objects";

/** Minimal shape needed to parse and validate a custom field's submitted value. */
export interface ValueFieldDef {
  key: string;
  type: string;
  label: string;
  required: boolean;
  defaultValue: string | null;
}

/**
 * Read custom-field values out of a submitted FormData, coercing by type.
 * `applyDefaults` fills empty scalars with the field's default (used on create).
 */
export function readValues(
  fields: ValueFieldDef[],
  formData: FormData,
  applyDefaults: boolean,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (isMultiValue(f.type)) {
      values[f.key] = formData.getAll(f.key).map(String).filter(Boolean);
      continue;
    }
    const raw = formData.get(f.key);
    if (f.type === "boolean") {
      values[f.key] = raw === "on";
    } else if (f.type === "number" || f.type === "currency" || f.type === "rating") {
      const n = Number(raw);
      let v = raw === null || raw === "" || Number.isNaN(n) ? null : n;
      if (v === null && applyDefaults && f.defaultValue != null && f.defaultValue !== "" && !Number.isNaN(Number(f.defaultValue))) {
        v = Number(f.defaultValue);
      }
      values[f.key] = v;
    } else {
      const s = raw == null ? "" : String(raw).trim();
      values[f.key] = s || (applyDefaults ? f.defaultValue || null : null);
    }
  }
  return values;
}

/** Labels of required fields left empty, for a friendly validation message. */
export function missingRequired(fields: ValueFieldDef[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.key];
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === "boolean") return false;
      return v == null || v === "";
    })
    .map((f) => f.label);
}
