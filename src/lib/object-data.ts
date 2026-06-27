import "server-only";
import type { Prisma } from "@prisma/client";
import { recordTitle, relationTarget, selectChoices, isRelationType, formatFieldValue, type FieldDefLite } from "./custom-objects";
import { listFields } from "./objects-registry";

/** A user-defined field resolved for rendering in a form (choices + relation options inlined). */
export interface ResolvedField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  choices: string[];
  relOptions: { id: string; label: string }[];
}

/** Resolve an object token's custom fields into form-ready field defs. */
export async function buildRecordFields(tx: Prisma.TransactionClient, token: string): Promise<ResolvedField[]> {
  const defs = await listFields(tx, token);
  return Promise.all(
    defs.map(async (f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      defaultValue: f.defaultValue,
      choices: selectChoices(f.options),
      relOptions:
        isRelationType(f.type) && relationTarget(f.options) ? await relationOptions(tx, relationTarget(f.options)!) : [],
    })),
  );
}

/** A custom field's value formatted for read-only display on a detail page. */
export interface FieldDisplay {
  key: string;
  label: string;
  type: string;
  display: string;
}

/** Resolve an object token's custom fields + a record's values into display strings. */
export async function buildFieldDisplays(
  tx: Prisma.TransactionClient,
  token: string,
  values: Record<string, unknown>,
): Promise<FieldDisplay[]> {
  const defs = await listFields(tx, token);
  const out: FieldDisplay[] = [];
  for (const f of defs) {
    let display: string;
    if (isRelationType(f.type)) {
      const target = relationTarget(f.options);
      const opts = target ? await relationOptions(tx, target) : [];
      const byId = new Map(opts.map((o) => [o.id, o.label]));
      const val = values[f.key];
      if (f.type === "relations") {
        const arr = Array.isArray(val) ? val : [];
        display = arr.length ? arr.map((id) => byId.get(String(id)) ?? "—").join(", ") : "—";
      } else {
        display = val ? byId.get(String(val)) ?? "—" : "—";
      }
    } else {
      display = formatFieldValue(f.type, values[f.key]);
    }
    out.push({ key: f.key, label: f.label, type: f.type, display });
  }
  return out;
}

export interface RelOption {
  id: string;
  label: string;
}

/** Options for a relation field, by target (core object or custom-object slug). */
export async function relationOptions(tx: Prisma.TransactionClient, target: string): Promise<RelOption[]> {
  if (target === "contact") {
    const rows = await tx.contact.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 500 });
    return rows.map((c) => ({
      id: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed",
    }));
  }
  if (target === "company") {
    const rows = await tx.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: 500 });
    return rows.map((c) => ({ id: c.id, label: c.name }));
  }
  if (target === "deal") {
    const rows = await tx.deal.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 500 });
    return rows.map((d) => ({ id: d.id, label: d.title }));
  }
  const def = await tx.objectDefinition.findFirst({ where: { slug: target }, include: { fields: true } });
  if (!def) return [];
  const recs = await tx.customRecord.findMany({
    where: { objectDefinitionId: def.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return recs.map((r) => ({
    id: r.id,
    label: recordTitle(def.fields as FieldDefLite[], r.values as Record<string, unknown>),
  }));
}

export interface LinkedRecord {
  slug: string;
  nameSingular: string;
  recordId: string;
  title: string;
  fieldLabel: string;
}

/**
 * Custom records that link (via a relation field) to a given target — a CRM
 * record ("contact"/"company"/"deal") or another custom object (its slug).
 * Powers the bidirectional "Linked records" mapping view.
 */
export async function getLinkedRecords(
  tx: Prisma.TransactionClient,
  targetType: string,
  targetId: string,
): Promise<LinkedRecord[]> {
  const defs = await tx.objectDefinition.findMany({ include: { fields: true } });
  const out: LinkedRecord[] = [];
  for (const def of defs) {
    const relFields = def.fields.filter((f) => isRelationType(f.type) && relationTarget(f.options) === targetType);
    if (relFields.length === 0) continue;
    const recs = await tx.customRecord.findMany({ where: { objectDefinitionId: def.id, deletedAt: null }, take: 500 });
    for (const r of recs) {
      const vals = r.values as Record<string, unknown>;
      const match = relFields.find((f) => {
        const v = vals[f.key];
        return Array.isArray(v) ? v.includes(targetId) : v === targetId;
      });
      if (match) {
        out.push({
          slug: def.slug,
          nameSingular: def.nameSingular,
          recordId: r.id,
          title: recordTitle(def.fields as FieldDefLite[], vals),
          fieldLabel: match.label,
        });
      }
    }
  }
  return out;
}
