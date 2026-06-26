import "server-only";
import type { Prisma } from "@prisma/client";
import { recordTitle, relationTarget, type FieldDefLite } from "./custom-objects";

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

/** Custom records that link (via a relation field) to a CRM record — powers the mapping view. */
export async function getLinkedRecords(
  tx: Prisma.TransactionClient,
  targetType: "contact" | "company" | "deal",
  targetId: string,
): Promise<LinkedRecord[]> {
  const defs = await tx.objectDefinition.findMany({ include: { fields: true } });
  const out: LinkedRecord[] = [];
  for (const def of defs) {
    const relFields = def.fields.filter((f) => f.type === "relation" && relationTarget(f.options) === targetType);
    if (relFields.length === 0) continue;
    const recs = await tx.customRecord.findMany({ where: { objectDefinitionId: def.id, deletedAt: null }, take: 500 });
    for (const r of recs) {
      const vals = r.values as Record<string, unknown>;
      const match = relFields.find((f) => vals[f.key] === targetId);
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
