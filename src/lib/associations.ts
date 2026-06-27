import "server-only";
import type { Prisma } from "@prisma/client";
import { recordTitle, CORE_RELATION_TARGETS, type FieldDefLite } from "./custom-objects";

export type ObjectTypeToken = string; // "contact" | "company" | "deal" | <custom slug>

export interface EndpointRef {
  objectType: ObjectTypeToken;
  recordId: string;
}

export interface ResolvedEndpoint {
  objectType: ObjectTypeToken;
  recordId: string;
  title: string;
  href: string;
  nameSingular: string;
  exists: boolean;
}

export interface AssociationView {
  edgeId: string;
  associationTypeId: string;
  label: string;
  cardinality: string;
  direction: "outgoing" | "incoming";
  other: ResolvedEndpoint;
}

const CORE = new Set(["contact", "company", "deal"]);
export function isCoreObject(objectType: string): boolean {
  return CORE.has(objectType);
}

function coreHref(objectType: string, id: string): string {
  if (objectType === "contact") return `/app/contacts/${id}`;
  if (objectType === "company") return `/app/companies/${id}`;
  if (objectType === "deal") return `/app/deals/${id}`;
  return `/app/o/${objectType}/${id}`;
}

const key = (t: string, id: string) => `${t}:${id}`;

/** Resolve many polymorphic endpoints into display rows, batched one query per object type. */
export async function resolveEndpoints(
  tx: Prisma.TransactionClient,
  refs: EndpointRef[],
): Promise<Map<string, ResolvedEndpoint>> {
  const map = new Map<string, ResolvedEndpoint>();
  if (refs.length === 0) return map;

  const byType = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!byType.has(r.objectType)) byType.set(r.objectType, new Set());
    byType.get(r.objectType)!.add(r.recordId);
  }

  for (const [objectType, idSet] of byType) {
    const ids = [...idSet];
    const titles = new Map<string, string>();
    let nameSingular = objectType;

    if (objectType === "contact") {
      nameSingular = "Contact";
      const rows = await tx.contact.findMany({ where: { id: { in: ids }, deletedAt: null } });
      rows.forEach((c) => titles.set(c.id, [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed"));
    } else if (objectType === "company") {
      nameSingular = "Company";
      const rows = await tx.company.findMany({ where: { id: { in: ids }, deletedAt: null } });
      rows.forEach((c) => titles.set(c.id, c.name));
    } else if (objectType === "deal") {
      nameSingular = "Deal";
      const rows = await tx.deal.findMany({ where: { id: { in: ids }, deletedAt: null } });
      rows.forEach((d) => titles.set(d.id, d.title));
    } else {
      const def = await tx.objectDefinition.findFirst({ where: { slug: objectType }, include: { fields: true } });
      if (def) {
        nameSingular = def.nameSingular;
        const recs = await tx.customRecord.findMany({
          where: { objectDefinitionId: def.id, id: { in: ids }, deletedAt: null },
        });
        recs.forEach((r) => titles.set(r.id, recordTitle(def.fields as FieldDefLite[], r.values as Record<string, unknown>)));
      }
    }

    for (const id of ids) {
      const title = titles.get(id);
      map.set(key(objectType, id), {
        objectType,
        recordId: id,
        title: title ?? "(removed)",
        href: coreHref(objectType, id),
        nameSingular,
        exists: title != null,
      });
    }
  }
  return map;
}

/** All object types a workspace can associate (core + every custom slug), for the config UI. */
export async function listAssociableObjects(tx: Prisma.TransactionClient): Promise<{ value: string; label: string }[]> {
  const defs = await tx.objectDefinition.findMany({ orderBy: { nameSingular: "asc" }, select: { slug: true, nameSingular: true } });
  return [
    ...CORE_RELATION_TARGETS.map((c) => ({ value: c.value, label: c.label })),
    ...defs.map((d) => ({ value: d.slug, label: d.nameSingular })),
  ];
}

/** Every association touching (objectType, recordId), both directions, side-label applied. */
export async function getAssociationsFor(
  tx: Prisma.TransactionClient,
  objectType: string,
  recordId: string,
): Promise<AssociationView[]> {
  const edges = await tx.recordAssociation.findMany({
    where: {
      OR: [
        { fromType: objectType, fromId: recordId },
        { toType: objectType, toId: recordId },
      ],
    },
    include: { associationType: true },
    orderBy: { createdAt: "desc" },
  });
  if (edges.length === 0) return [];

  const refs: EndpointRef[] = edges.map((e) => {
    const outgoing = e.fromType === objectType && e.fromId === recordId;
    return outgoing ? { objectType: e.toType, recordId: e.toId } : { objectType: e.fromType, recordId: e.fromId };
  });
  const resolved = await resolveEndpoints(tx, refs);

  const views: AssociationView[] = [];
  for (const e of edges) {
    const outgoing = e.fromType === objectType && e.fromId === recordId;
    const otherRef = outgoing ? { t: e.toType, id: e.toId } : { t: e.fromType, id: e.fromId };
    const other = resolved.get(key(otherRef.t, otherRef.id));
    if (!other || !other.exists) continue;
    views.push({
      edgeId: e.id,
      associationTypeId: e.associationTypeId,
      label: outgoing ? e.associationType.label : e.associationType.inverseLabel,
      cardinality: e.associationType.cardinality,
      direction: outgoing ? "outgoing" : "incoming",
      other,
    });
  }
  return views;
}

/** Association types available to add on this record, with the side to pick from. */
export async function availableAssociationTypes(
  tx: Prisma.TransactionClient,
  objectType: string,
): Promise<{ associationTypeId: string; label: string; cardinality: string; otherObject: string; pickFromSide: "to" | "from" }[]> {
  const types = await tx.associationType.findMany({
    where: { OR: [{ fromObject: objectType }, { toObject: objectType }] },
    orderBy: { label: "asc" },
  });
  return types.map((t) => {
    // When this record is the `from` side, we pick a `to` record; otherwise we pick a `from`.
    const recordIsFrom = t.fromObject === objectType;
    return {
      associationTypeId: t.id,
      label: recordIsFrom ? t.label : t.inverseLabel,
      cardinality: t.cardinality,
      otherObject: recordIsFrom ? t.toObject : t.fromObject,
      pickFromSide: recordIsFrom ? ("to" as const) : ("from" as const),
    };
  });
}

/** Hard-delete every edge touching (objectType, recordId). Called in the record-delete tx. */
export async function cleanupAssociations(
  tx: Prisma.TransactionClient,
  objectType: string,
  recordId: string,
): Promise<void> {
  await tx.recordAssociation.deleteMany({
    where: {
      OR: [
        { fromType: objectType, fromId: recordId },
        { toType: objectType, toId: recordId },
      ],
    },
  });
}
