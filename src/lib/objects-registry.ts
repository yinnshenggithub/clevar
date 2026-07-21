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

/** A built-in column on a core object — shown read-only alongside custom fields. */
export interface BuiltinField {
  key: string;
  label: string;
  type: string; // a FieldType key, for label/badge rendering
  required?: boolean;
  target?: string; // relation target token, display only
}

/** Standard (non-removable) columns per core object, in display order. */
export const BUILTIN_FIELDS: Record<string, BuiltinField[]> = {
  contact: [
    { key: "firstName", label: "First name", type: "text" },
    { key: "lastName", label: "Last name", type: "text" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone" },
    { key: "jobTitle", label: "Job title", type: "text" },
    { key: "companyId", label: "Company", type: "relation", target: "company" },
    { key: "tags", label: "Tags", type: "multi_select" },
    { key: "ownerId", label: "Owner", type: "relation", target: "member" },
    { key: "dnd", label: "Do not disturb", type: "boolean" },
    { key: "engagementScore", label: "Engagement score", type: "number" },
  ],
  company: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "domain", label: "Domain", type: "url" },
    { key: "industry", label: "Industry", type: "text" },
  ],
  deal: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "amount", label: "Amount", type: "currency" },
    { key: "currency", label: "Currency", type: "text" },
    { key: "status", label: "Status", type: "select" },
    { key: "pipelineId", label: "Pipeline", type: "relation", target: "pipeline" },
    { key: "stageId", label: "Stage", type: "relation", target: "stage" },
    { key: "companyId", label: "Company", type: "relation", target: "company" },
    { key: "contactIds", label: "Contacts", type: "relations", target: "contact" },
    { key: "expectedCloseAt", label: "Expected close", type: "date" },
  ],
  task: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "body", label: "Description", type: "rich_text" },
    { key: "status", label: "Status", type: "select" },
    { key: "dueAt", label: "Due date", type: "date" },
    { key: "assigneeId", label: "Assignee", type: "relation", target: "member" },
  ],
  note: [
    { key: "body", label: "Body", type: "rich_text", required: true },
  ],
};

/** Built-in columns for a token (empty for custom objects). */
export function listBuiltinFields(token: string): BuiltinField[] {
  return BUILTIN_FIELDS[token] ?? [];
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
