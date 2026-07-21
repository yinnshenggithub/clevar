import "server-only";
import type { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { listBuiltinFields } from "./objects-registry";
import { formatFieldValue, isRelationType } from "./custom-objects";

/**
 * Generic, registry-driven property read/write for the AI agent — keyed by the
 * qualified `object.key` scheme surfaced in Settings → Properties (e.g.
 * `contact.firstName`, `contact.budget`, `project.location`).
 *
 * The agent's write target is anchored on the conversation's linked contact:
 *   contact.*        → the contact itself
 *   company.*        → the contact's company (auto-created + linked via company.name)
 *   deal.*           → the most recent deal linked to the contact
 *   <custom slug>.*  → a custom record associated with the contact (find-or-create)
 *
 * task/note are activity objects, not profile records, so they're intentionally
 * excluded from the catalog — they have dedicated agent actions (note/close/…).
 */

/** Core objects that can carry collected profile data (task/note excluded). */
const WRITABLE_CORE = ["contact", "company", "deal"] as const;
const CORE_MODEL: Record<string, "contact" | "company" | "deal"> = {
  contact: "contact",
  company: "company",
  deal: "deal",
};

export interface PropertyEntry {
  object: string; // token
  key: string;
  qualified: string; // `${object}.${key}`
  label: string;
  type: string;
  kind: "builtin" | "custom";
}

/** A property is writable unless it's a relation/link or a managed lifecycle enum. */
function isWritableType(type: string, key: string): boolean {
  if (isRelationType(type)) return false;
  if (key === "status") return false; // deal/task lifecycle — managed by label/stage
  return true;
}

/**
 * Every writable property across contact/company/deal + all custom objects.
 * Built-in columns come from the registry; custom fields + custom objects from
 * CustomFieldDef / ObjectDefinition.
 */
export async function loadPropertyCatalog(workspaceId: string): Promise<PropertyEntry[]> {
  return withTenant(workspaceId, async (tx) => {
    const out: PropertyEntry[] = [];

    // Built-in columns on the core profile objects.
    for (const object of WRITABLE_CORE) {
      for (const f of listBuiltinFields(object)) {
        if (!isWritableType(f.type, f.key)) continue;
        out.push({ object, key: f.key, qualified: `${object}.${f.key}`, label: f.label, type: f.type, kind: "builtin" });
      }
    }

    // Custom fields on core objects + custom object fields.
    const defs = await tx.customFieldDef.findMany({ orderBy: [{ objectType: "asc" }, { position: "asc" }] });
    const customObjectTokens = new Set(
      (await tx.objectDefinition.findMany({ select: { slug: true } })).map((d) => d.slug),
    );
    for (const d of defs) {
      // Only surface custom fields for objects we can anchor a write on.
      const isCoreProfile = (WRITABLE_CORE as readonly string[]).includes(d.objectType);
      if (!isCoreProfile && !customObjectTokens.has(d.objectType)) continue;
      if (!isWritableType(d.type, d.key)) continue;
      out.push({ object: d.objectType, key: d.key, qualified: `${d.objectType}.${d.key}`, label: d.label, type: d.type, kind: "custom" });
    }

    return out;
  });
}

/** Human-readable, model-facing description of every writable key, grouped by object. */
export function describeCatalog(catalog: PropertyEntry[]): string {
  if (!catalog.length) return "No writable properties are configured.";
  const byObject = new Map<string, PropertyEntry[]>();
  for (const e of catalog) {
    if (!byObject.has(e.object)) byObject.set(e.object, []);
    byObject.get(e.object)!.push(e);
  }
  const lines = [...byObject.entries()].map(
    ([object, entries]) => `• ${object}: ${entries.map((e) => `${e.qualified} (${e.label}, ${e.type})`).join(", ")}`,
  );
  return lines.join("\n");
}

function parseQualified(property: string): { object: string; key: string } | null {
  const dot = property.indexOf(".");
  if (dot <= 0 || dot === property.length - 1) return null;
  return { object: property.slice(0, dot), key: property.slice(dot + 1) };
}

/** Coerce a model-supplied string into the stored JS value for a field type. */
function coerce(type: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = raw.trim();
  switch (type) {
    case "number":
    case "currency":
    case "rating": {
      const n = Number(s.replace(/[^0-9.\-]/g, ""));
      if (Number.isNaN(n)) return { ok: false, error: `"${raw}" is not a number` };
      return { ok: true, value: n };
    }
    case "boolean":
      return { ok: true, value: /^(true|yes|y|1|on)$/i.test(s) };
    case "multi_select":
      return { ok: true, value: s.split(",").map((x) => x.trim()).filter(Boolean) };
    case "date": {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return { ok: false, error: `"${raw}" is not a valid date` };
      return { ok: true, value: d };
    }
    default:
      return { ok: true, value: s };
  }
}

/** JSON-safe form of a coerced value (Dates → YYYY-MM-DD). */
function jsonify(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value as Prisma.InputJsonValue;
}

type CoreModel = "contact" | "company" | "deal";

async function mergeJson(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  model: CoreModel,
  id: string,
  key: string,
  value: unknown,
): Promise<void> {
  const delegate = tx[model] as {
    findFirst: (a: unknown) => Promise<{ customFields: unknown } | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  const row = await delegate.findFirst({ where: { id }, select: { customFields: true } });
  if (!row) return;
  const merged = { ...((row.customFields as Record<string, unknown>) ?? {}), [key]: jsonify(value) };
  await delegate.update({ where: { id }, data: { customFields: merged as Prisma.InputJsonValue } });
}

/**
 * Resolve the record a write/read should target, given the object token and the
 * conversation's contact anchor. `create` allows find-or-create for company (via
 * name) and custom objects. Returns the record id + (for custom objects) the
 * object-definition id, or a reason string when it can't be resolved.
 */
async function resolveTarget(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  object: string,
  contactId: string,
  opts: { create: boolean; createValueForName?: string },
): Promise<{ ok: true; id: string; defId?: string } | { ok: false; reason: string }> {
  if (object === "contact") {
    const c = await tx.contact.findFirst({ where: { id: contactId }, select: { id: true } });
    return c ? { ok: true, id: c.id } : { ok: false, reason: "the linked contact no longer exists" };
  }

  if (object === "company") {
    const c = await tx.contact.findFirst({ where: { id: contactId }, select: { companyId: true } });
    if (c?.companyId) return { ok: true, id: c.companyId };
    if (opts.create && opts.createValueForName?.trim()) {
      const company = await tx.company.create({ data: { workspaceId, name: opts.createValueForName.trim() } });
      await tx.contact.update({ where: { id: contactId }, data: { companyId: company.id } });
      return { ok: true, id: company.id };
    }
    return { ok: false, reason: "no company is linked to this contact yet — set company.name first" };
  }

  if (object === "deal") {
    const dc = await tx.dealContact.findFirst({ where: { contactId }, orderBy: { createdAt: "desc" }, select: { dealId: true } });
    if (dc) return { ok: true, id: dc.dealId };
    return { ok: false, reason: "no deal is linked to this contact — a deal must exist before its fields can be set" };
  }

  // Custom object.
  const def = await tx.objectDefinition.findFirst({ where: { slug: object } });
  if (!def) return { ok: false, reason: `"${object}" is not a known object` };

  const existing = await tx.recordAssociation.findFirst({
    where: {
      OR: [
        { fromType: "contact", fromId: contactId, toType: object },
        { fromType: object, toType: "contact", toId: contactId },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    const recId = existing.fromType === object ? existing.fromId : existing.toId;
    const rec = await tx.customRecord.findFirst({ where: { id: recId, deletedAt: null }, select: { id: true } });
    if (rec) return { ok: true, id: rec.id, defId: def.id };
  }

  if (!opts.create) return { ok: false, reason: `no ${def.nameSingular.toLowerCase()} is linked to this contact yet` };

  // Find-or-create the association kind, then create the record + edge.
  const assocType =
    (await tx.associationType.findFirst({ where: { fromObject: "contact", toObject: object } })) ??
    (await tx.associationType.create({
      data: {
        workspaceId,
        fromObject: "contact",
        toObject: object,
        label: def.namePlural,
        inverseLabel: "Contact",
        cardinality: "one_to_many",
      },
    }));
  const record = await tx.customRecord.create({ data: { workspaceId, objectDefinitionId: def.id, values: {} } });
  await tx.recordAssociation.create({
    data: { workspaceId, associationTypeId: assocType.id, fromType: "contact", fromId: contactId, toType: object, toId: record.id },
  });
  return { ok: true, id: record.id, defId: def.id };
}

export interface PropertyResult {
  ok: boolean;
  message: string;
}

/** Store a value into `object.key`, resolving/creating the target record as needed. */
export async function writeProperty(
  workspaceId: string,
  args: { catalog: PropertyEntry[]; contactId: string | null | undefined; property: string; value: string },
): Promise<PropertyResult> {
  const parsed = parseQualified(args.property);
  if (!parsed) return { ok: false, message: `"${args.property}" is not a valid property. Use the form object.key, e.g. contact.firstName.` };
  const entry = args.catalog.find((e) => e.object === parsed.object && e.key === parsed.key);
  if (!entry) return { ok: false, message: `"${args.property}" is not a writable property.` };
  if (!args.contactId) return { ok: false, message: "No contact is linked to this conversation, so there's nowhere to store this yet." };

  const coerced = coerce(entry.type, args.value);
  if (!coerced.ok) return { ok: false, message: coerced.error };

  return withTenant(workspaceId, async (tx) => {
    const target = await resolveTarget(tx, workspaceId, entry.object, args.contactId!, {
      create: true,
      createValueForName: entry.object === "company" && entry.key === "name" ? args.value : undefined,
    });
    if (!target.ok) return { ok: false, message: target.reason };

    if (entry.object in CORE_MODEL) {
      const model = CORE_MODEL[entry.object];
      if (entry.kind === "builtin") {
        const data = { [entry.key]: entry.key === "engagementScore" ? Math.round(Number(coerced.value)) : coerced.value };
        await (tx[model] as { update: (a: unknown) => Promise<unknown> }).update({ where: { id: target.id }, data });
      } else {
        await mergeJson(tx, workspaceId, model, target.id, entry.key, coerced.value);
      }
    } else {
      // Custom object record — everything lives in the values JSON.
      const rec = await tx.customRecord.findFirst({ where: { id: target.id }, select: { values: true } });
      const merged = { ...((rec?.values as Record<string, unknown>) ?? {}), [entry.key]: jsonify(coerced.value) };
      await tx.customRecord.update({ where: { id: target.id }, data: { values: merged as Prisma.InputJsonValue } });
    }

    return { ok: true, message: `Saved ${entry.qualified} = ${formatFieldValue(entry.type, coerced.value)}.` };
  });
}

/** Read the current value of `object.key` for the linked contact's record graph. */
export async function readProperty(
  workspaceId: string,
  args: { catalog: PropertyEntry[]; contactId: string | null | undefined; property: string },
): Promise<PropertyResult> {
  const parsed = parseQualified(args.property);
  if (!parsed) return { ok: false, message: `"${args.property}" is not a valid property.` };
  const entry = args.catalog.find((e) => e.object === parsed.object && e.key === parsed.key);
  if (!entry) return { ok: false, message: `"${args.property}" is not a known property.` };
  if (!args.contactId) return { ok: false, message: "No contact is linked to this conversation." };

  return withTenant(workspaceId, async (tx) => {
    const target = await resolveTarget(tx, workspaceId, entry.object, args.contactId!, { create: false });
    if (!target.ok) return { ok: true, message: `${entry.qualified} is not set (${target.reason}).` };

    let raw: unknown;
    if (entry.object in CORE_MODEL) {
      const model = CORE_MODEL[entry.object];
      const select = entry.kind === "builtin" ? { [entry.key]: true } : { customFields: true };
      const row = (await (tx[model] as { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> }).findFirst({
        where: { id: target.id },
        select,
      })) as Record<string, unknown> | null;
      raw = entry.kind === "builtin" ? row?.[entry.key] : (row?.customFields as Record<string, unknown>)?.[entry.key];
    } else {
      const rec = await tx.customRecord.findFirst({ where: { id: target.id }, select: { values: true } });
      raw = (rec?.values as Record<string, unknown>)?.[entry.key];
    }
    return { ok: true, message: `${entry.qualified} = ${formatFieldValue(entry.type, raw)}` };
  });
}
