import "server-only";
import type { Prisma } from "@prisma/client";

/** A targetable object — built-in or custom — that can carry user-defined fields. */
export interface ObjectMeta {
  token: string; // "contact" | "company" | "deal" | "task" | "note" | <custom slug>
  label: string; // singular
  pluralLabel: string;
  kind: "core" | "custom";
  /** Reserved keys a custom field key must never collide with (real columns + form names). */
  reservedKeys: string[];
  objectDefinitionId?: string; // custom objects only
}

const COMMON_RESERVED = ["id", "createdAt", "updatedAt", "workspaceId", "deletedAt", "customFields"];

export const CORE_OBJECTS: ObjectMeta[] = [
  {
    token: "contact",
    label: "Contact",
    pluralLabel: "Contacts",
    kind: "core",
    reservedKeys: [...COMMON_RESERVED, "firstName", "lastName", "email", "phone", "phoneRegion", "jobTitle", "companyId", "newCompanyName", "targetId"],
  },
  {
    token: "company",
    label: "Company",
    pluralLabel: "Companies",
    kind: "core",
    reservedKeys: [...COMMON_RESERVED, "name", "domain", "industry"],
  },
  {
    token: "deal",
    label: "Deal",
    pluralLabel: "Deals",
    kind: "core",
    reservedKeys: [...COMMON_RESERVED, "title", "amount", "currency", "status", "pipelineId", "stageId", "companyId", "expectedCloseAt", "contactIds"],
  },
  {
    token: "task",
    label: "Task",
    pluralLabel: "Tasks",
    kind: "core",
    reservedKeys: [...COMMON_RESERVED, "title", "body", "status", "dueAt", "assigneeId", "parentType", "parentId"],
  },
  {
    token: "note",
    label: "Note",
    pluralLabel: "Notes",
    kind: "core",
    reservedKeys: [...COMMON_RESERVED, "body", "parentType", "parentId"],
  },
];

const CORE_BY_TOKEN = new Map(CORE_OBJECTS.map((o) => [o.token, o]));

export function isCoreToken(token: string): boolean {
  return CORE_BY_TOKEN.has(token);
}

/** All objects (core + custom) — for the field-settings object picker. */
export async function listObjects(tx: Prisma.TransactionClient): Promise<ObjectMeta[]> {
  const defs = await tx.objectDefinition.findMany({ orderBy: { nameSingular: "asc" } });
  const custom = defs.map<ObjectMeta>((d) => ({
    token: d.slug,
    label: d.nameSingular,
    pluralLabel: d.namePlural,
    kind: "custom",
    reservedKeys: [...COMMON_RESERVED],
    objectDefinitionId: d.id,
  }));
  return [...CORE_OBJECTS, ...custom];
}

/** Resolve one object's meta from its token, or null if the token is unknown. */
export async function getObjectMeta(tx: Prisma.TransactionClient, token: string): Promise<ObjectMeta | null> {
  const core = CORE_BY_TOKEN.get(token);
  if (core) return core;
  const def = await tx.objectDefinition.findFirst({ where: { slug: token } });
  if (!def) return null;
  return {
    token: def.slug,
    label: def.nameSingular,
    pluralLabel: def.namePlural,
    kind: "custom",
    reservedKeys: [...COMMON_RESERVED],
    objectDefinitionId: def.id,
  };
}

export interface FieldDefRow {
  id: string;
  objectType: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  options: unknown;
  position: number;
}

/** Ordered field definitions for an object token (core or custom). */
export async function listFields(tx: Prisma.TransactionClient, token: string): Promise<FieldDefRow[]> {
  const rows = await tx.customFieldDef.findMany({
    where: { objectType: token },
    orderBy: { position: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    objectType: r.objectType,
    key: r.key,
    label: r.label,
    type: r.type,
    required: r.required,
    defaultValue: r.defaultValue,
    options: r.options,
    position: r.position,
  }));
}
