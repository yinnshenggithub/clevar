import "server-only";
import type { Scope, StepCondition } from "./types";

/** Walk a dotted path against the scope; returns undefined if any hop is missing. */
function lookup(scope: Scope, path: string): unknown {
  const parts = path.split(".");
  // top-level namespaces map onto the scope; everything else is a typo → undefined
  let cur: unknown = scope as unknown as Record<string, unknown>;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Resolve `{{contact.firstName}}` / `{{trigger.messageText}}` / `{{vars.x}}` /
 * `{{customValue.key}}` merge fields in a template string. Unknown paths render
 * empty (never throws). A literal string with no `{{}}` passes through.
 */
export function renderTemplate(tpl: string | undefined | null, scope: Scope): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => asString(lookup(scope, path)));
}

/** Coerce a possibly-templated config value to a number (commas stripped). */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Evaluate a step condition against the scope. Empty condition ⇒ true. */
export function evalCondition(cond: StepCondition | undefined, scope: Scope): boolean {
  if (!cond || !cond.field) return true;
  const raw = lookup(scope, cond.field);
  const target = renderTemplate(cond.value ?? "", scope);
  const left = asString(raw).toLowerCase();
  const right = target.toLowerCase();
  switch (cond.op) {
    case "exists":
      return raw != null && asString(raw) !== "";
    case "not_exists":
      return raw == null || asString(raw) === "";
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "not_contains":
      return !left.includes(right);
    case "starts_with":
      return left.startsWith(right);
    case "gt": {
      const a = toNumber(raw);
      const b = toNumber(target);
      return a != null && b != null && a > b;
    }
    case "lt": {
      const a = toNumber(raw);
      const b = toNumber(target);
      return a != null && b != null && a < b;
    }
    case "has_tag":
      return Array.isArray(raw) && raw.map((t) => asString(t).toLowerCase()).includes(right);
    case "is_true":
      return raw === true || left === "true";
    case "is_false":
      return raw === false || left === "false" || raw == null;
    default:
      return false;
  }
}
