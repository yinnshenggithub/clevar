# Record Associations — Design Specification

**Status:** Draft for review · **Date:** 2026-06-27 · **Scope:** First-class record-to-record associations for core CRM objects and custom objects

---

## 1. Problem Statement

The CRM lets a workspace define custom objects (metadata-driven, see `ObjectDefinition` / `CustomFieldDef` / `CustomRecord` in `prisma/schema.prisma`) and link records together. Today that linking is shallow and inconsistent:

- **Custom-object relations are JSON pointers.** A `CustomFieldDef` of type `relation` or `relations` stores its target object in `options.target` (e.g. `{ "target": "company" }`), and the linked record id(s) live as bare strings inside the `CustomRecord.values` JSON blob (`relation` → a string id; `relations` → an array of string ids). There is **no edge table, no foreign key, no inverse side, no cardinality enforcement, and no cleanup**. When a linked record is deleted, the pointer is left dangling — `getLinkedRecords` (`src/lib/object-data.ts`) and `relationOptions` happily return or skip ids that no longer resolve. Deletes are *soft* (`deletedAt`), so a pointer can also reference a row that is "gone" from the UI but still present in the table.
- **Core associations are bespoke and hardcoded, one per pair.** `Contact.companyId` (a real FK, `onDelete: SetNull`), `Deal.companyId` (FK, `SetNull`), and the `DealContact` M2M join table (`prisma/schema.prisma` ~line 665) each solve exactly one relationship with custom server actions (`addContactToCompany` / `removeContactFromCompany` in `src/lib/actions/companies.ts`; `syncDealContacts` in `src/lib/actions/deals.ts`). There is no generic way to relate, say, a Contact to a custom "Project", or a custom "Asset" to a Deal.
- **No shared model.** Because core links and custom links use entirely different mechanisms, there is no single query, no single panel, and no single config surface that answers "what is this record connected to?"

We want a **universal, first-class association system**: any record of any object type can be related to any record of any other object type, with named/inverse-named relationships, cardinality rules enforced at write time, automatic cleanup on delete, and a consistent UI on every detail page. This must be **additive and non-breaking** — existing `relation`/`relations` fields and the existing core FKs keep working unchanged during and after rollout.

### 1.1 Latent bug to fix in passing

`addField` in `src/lib/actions/objects.ts` (lines ~102–106) only persists `options.target` when `type === "relation"`. For `type === "relations"` (the many-to-many link type) it falls through and stores `options = {}`. The field renders in the object manager but `relationTarget(f.options)` returns `null`, so:

- `relationOptions(tx, …)` is never called for it (no picker options),
- `getLinkedRecords` never matches it (the inverse side is invisible),
- the field is effectively dead.

This spec corrects it (Plan task 8): the `relationTarget` read must apply to `isRelationType(type)`, not just `"relation"`. This fix is independent of the association layer and ships in the same change because the association config surface relies on every relation field carrying a valid `target`.

---

## 2. Goals & Non-Goals

### Goals

1. A polymorphic edge model that can connect **any object pair**: core↔core, core↔custom, custom↔custom. Endpoints are identified by `(objectType, recordId)` where `objectType ∈ {"contact","company","deal"} ∪ <custom object slug>`.
2. Workspace-defined **association types** with a human label, an inverse label, and a cardinality (`one_to_one | one_to_many | many_to_many`).
3. **Cardinality enforced at write time** and **automatic cleanup** of edges when either endpoint record is deleted — eliminating the dangling-pointer class of bug.
4. **Bidirectional rendering**: both endpoints display the link, each using the side-appropriate label.
5. A **config surface** to define association types and an **Associations panel** on every record detail page (core + custom) to add/remove links, mirroring the existing Company→Contacts add/remove UX.
6. Full **tenant isolation** via RLS, consistent with every other tenant table.
7. Non-breaking: existing `relation`/`relations` fields and the hardcoded core FKs (`Contact.companyId`, `Deal.companyId`, `DealContact`) keep working. An optional backfill can materialize existing JSON pointers into edges.

### Non-Goals

- We do **not** migrate or retire the hardcoded core FKs (`Contact.companyId`, `Deal.companyId`, `DealContact`) in this spec. They remain the source of truth for those three specific relationships; the association layer is additive. (A future spec may unify them.)
- We do **not** add association-based filtering/reporting, association-scoped permissions, or ordering/weighting of edges. Edges are an unordered set per type.
- We do **not** add cross-workspace associations. Both endpoints are always in the same workspace (enforced by RLS).
- We do **not** build a visual graph explorer. Rendering is per-record lists.

---

## 3. Canonical naming registry

These names are authoritative and used everywhere in this document, the implementation plan, and the proposed code.

| Concept | DB table | Prisma model | Notes |
|---|---|---|---|
| Association definition | `association_types` | `AssociationType` | RLS-protected tenant table |
| Association edge | `record_associations` | `RecordAssociation` | RLS-protected tenant table |
| Endpoint object type | — (string column) | — | `"contact" \| "company" \| "deal" \| <custom slug>` |
| Endpoint id | — (uuid column) | — | `Contact.id` / `Company.id` / `Deal.id` / `CustomRecord.id` |
| Cardinality | — (string column) | — | `"one_to_one" \| "one_to_many" \| "many_to_many"` |

**Object-type vocabulary rule.** An endpoint `objectType` is the lowercase string `"contact"`, `"company"`, `"deal"`, **or** an `ObjectDefinition.slug`. Custom-object slugs are validated at object-creation time (`slugify`) and are unique per workspace (`@@unique([workspaceId, slug])`), so they never collide with the three reserved core tokens **provided** we reserve them. **Reserved-slug rule:** object creation MUST reject the slugs `contact`, `company`, `deal` (and their natural plurals already produce different slugs, but we guard the singular tokens explicitly). This is enforced in `createObjectDefinition` (Plan task 8).

**Direction rule.** Every edge is stored **once**, directionally, as `(fromType, fromId) → (toType, toId)` under an `AssociationType` whose `(fromObject, toObject)` matches `(fromType, toType)`. The inverse view is *derived*, never stored twice. "Add from the Company side" and "add from the Contact side" of the same Company↔Contact type both write a single row with `from = company`, `to = contact` (the action normalizes direction to the type's declared orientation — see §6.3).

---

## 4. Data Model

### 4.1 Prisma models

Appended to `prisma/schema.prisma`, in the custom-objects section. Both are tenant-plane (RLS) tables and follow the repo conventions (`@db.Uuid`, `@map` snake_case, `workspaceId` first, `Workspace` back-relation with `onDelete: Cascade`).

```prisma
// ─────────────── Record associations (polymorphic, tenant plane, RLS) ───────────────

// A workspace-defined relationship kind between two object types. Endpoints are
// polymorphic: each side is an object type token ("contact"|"company"|"deal" or a
// custom-object slug). The pair is directional — `fromObject` → `toObject` — and the
// inverse view is derived from `inverseLabel`, never stored as a second row.
model AssociationType {
  id           String   @id @default(uuid()) @db.Uuid
  workspaceId  String   @map("workspace_id") @db.Uuid
  fromObject   String   @map("from_object") // "contact"|"company"|"deal"|<custom slug>
  toObject     String   @map("to_object")
  label        String                       // shown on the `from` record, e.g. "Primary contact"
  inverseLabel String   @map("inverse_label") // shown on the `to` record, e.g. "Account"
  cardinality  String   @default("many_to_many") // one_to_one | one_to_many | many_to_many
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  workspace    Workspace            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  associations RecordAssociation[]

  // One association type per directed object pair + label, per workspace.
  @@unique([workspaceId, fromObject, toObject, label])
  @@index([workspaceId, fromObject])
  @@index([workspaceId, toObject])
  @@map("association_types")
}

// A single edge between two records. Stored once, directionally. Endpoint records
// are NOT foreign-keyed (they live across four heterogeneous tables — three core +
// custom_records), so referential integrity for endpoints is enforced in the
// application layer + the cascade-cleanup helper (see §5.3), not by Postgres FKs.
model RecordAssociation {
  id                String   @id @default(uuid()) @db.Uuid
  workspaceId       String   @map("workspace_id") @db.Uuid
  associationTypeId String   @map("association_type_id") @db.Uuid
  fromType          String   @map("from_type")
  fromId            String   @map("from_id") @db.Uuid
  toType            String   @map("to_type")
  toId              String   @map("to_id") @db.Uuid
  createdById       String?  @map("created_by_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz
  workspace         Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  associationType   AssociationType @relation(fields: [associationTypeId], references: [id], onDelete: Cascade)

  // No duplicate edge of the same type between the same two records.
  @@unique([associationTypeId, fromType, fromId, toType, toId])
  // Fast lookups from either endpoint (both directions of a detail-page query).
  @@index([workspaceId, fromType, fromId])
  @@index([workspaceId, toType, toId])
  @@map("record_associations")
}
```

Add the back-relations to the `Workspace` model (mirroring the existing `objectDefinitions` / `customRecords` lines):

```prisma
  associationTypes  AssociationType[]
  recordAssociations RecordAssociation[]
```

**Why no FK on endpoints?** A `RecordAssociation` endpoint can point at `contacts`, `companies`, `deals`, or `custom_records` depending on `fromType`/`toType`. Postgres cannot express a single FK over a polymorphic column, and we will not split the edge table per target (that would defeat the "universal" goal). Integrity is therefore maintained by: (a) write-time existence checks in the server action, (b) the `cleanupAssociations` helper invoked from every record delete, and (c) the read-time resolver skipping unresolvable endpoints defensively. This is the same trade-off the codebase already accepts for the polymorphic `Note.parentType/parentId` and `ActivityEvent.parentType/parentId` columns (see `prisma/schema.prisma`), so it is consistent with house style.

**Why `cardinality` / `objectType` as strings, not enums?** `objectType` is open-ended (every new custom object adds a value), so it cannot be a Postgres enum. For symmetry and to avoid a migration every time we tune the set, `cardinality` is also a checked string (validated in the app via a TS union + a `CHECK` constraint, §4.3) — matching how the codebase already stores open vocabularies as `text` (e.g. `Workflow.triggerType`, `ActivityEvent.type`, `ChannelConnection.provider`).

### 4.2 Migration SQL (`prisma/migrations/23_record_associations/migration.sql`)

Generated by `prisma migrate diff`, then hand-appended with the RLS block (copied shape from `22_channel_connections` and the `DO $$ … FOREACH` loop in `8_custom_objects`). The helper functions `clevar_current_workspace()` and `clevar_set_workspace_id()` already exist (created in `1_rls`).

```sql
-- CreateTable
CREATE TABLE "association_types" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "from_object" TEXT NOT NULL,
    "to_object" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "inverse_label" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL DEFAULT 'many_to_many',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "association_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_associations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "association_type_id" UUID NOT NULL,
    "from_type" TEXT NOT NULL,
    "from_id" UUID NOT NULL,
    "to_type" TEXT NOT NULL,
    "to_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_associations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "association_types_workspace_id_from_object_idx" ON "association_types"("workspace_id", "from_object");
CREATE INDEX "association_types_workspace_id_to_object_idx" ON "association_types"("workspace_id", "to_object");
CREATE UNIQUE INDEX "association_types_workspace_id_from_object_to_object_label_key" ON "association_types"("workspace_id", "from_object", "to_object", "label");

CREATE INDEX "record_associations_workspace_id_from_type_from_id_idx" ON "record_associations"("workspace_id", "from_type", "from_id");
CREATE INDEX "record_associations_workspace_id_to_type_to_id_idx" ON "record_associations"("workspace_id", "to_type", "to_id");
CREATE UNIQUE INDEX "record_associations_assoc_from_to_key" ON "record_associations"("association_type_id", "from_type", "from_id", "to_type", "to_id");

-- AddForeignKey
ALTER TABLE "association_types" ADD CONSTRAINT "association_types_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_associations" ADD CONSTRAINT "record_associations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_associations" ADD CONSTRAINT "record_associations_association_type_id_fkey" FOREIGN KEY ("association_type_id") REFERENCES "association_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK: cardinality vocabulary (mirrors the TS union)
ALTER TABLE "association_types" ADD CONSTRAINT "association_types_cardinality_check"
  CHECK ("cardinality" IN ('one_to_one','one_to_many','many_to_many'));

-- RLS for the association tenant tables (template copied from 8_custom_objects / 22_channel_connections).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['association_types', 'record_associations'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())', t);
    EXECUTE format('CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()', t);
  END LOOP;
END $$;
```

### 4.3 Invariants

- **Tenant.** Both tables carry `workspace_id`; the `set_workspace_id` trigger stamps it from the GUC, and `tenant_isolation` gates every row. Endpoints are guaranteed same-workspace because every endpoint record is itself an RLS-gated row read inside the same `withTenant` transaction.
- **No duplicate edges.** `@@unique([associationTypeId, fromType, fromId, toType, toId])`.
- **Cardinality** is enforced in the app layer at write time (§5.2). The DB `CHECK` only constrains the *vocabulary*, not the count, because count enforcement spans rows and depends on direction.
- **Endpoint existence** is checked at write time and reconciled at read time; cleanup runs on delete (§5.3).

---

## 5. Behavior & Server-Action Surface

All writes go through `withTenant(ctx.workspaceId, fn)` and `requireAuth()`, exactly like every existing action. New code lives in two files:

- `src/lib/associations.ts` — pure/server-only resolution + query helpers (no `"use server"`; called *inside* a `withTenant` tx, like `src/lib/object-data.ts`).
- `src/lib/actions/associations.ts` — the `"use server"` action module (like `src/lib/actions/objects.ts`).

### 5.1 Endpoint resolution (`src/lib/associations.ts`)

A single resolver turns an `(objectType, recordId)` endpoint into a display row, dispatching on whether the type is a core token or a custom slug. It reuses `recordTitle` and the same per-table title logic already in `relationOptions`.

```ts
export type ObjectTypeToken = string; // "contact" | "company" | "deal" | <custom slug>

export interface EndpointRef { objectType: ObjectTypeToken; recordId: string; }

export interface ResolvedEndpoint {
  objectType: ObjectTypeToken;
  recordId: string;
  title: string;        // display title
  href: string;         // detail-page link
  nameSingular: string; // "Contact" | "Company" | "Deal" | def.nameSingular
  exists: boolean;      // false ⇒ deleted/dangling; caller may hide or show "(removed)"
}

// Resolve many endpoints in as few queries as possible (group by objectType, one query each).
export async function resolveEndpoints(
  tx: Prisma.TransactionClient,
  refs: EndpointRef[],
): Promise<Map<string, ResolvedEndpoint>>; // key = `${objectType}:${recordId}`

// True if the token is one of the three reserved core object types.
export function isCoreObject(objectType: string): boolean; // contact|company|deal

// All object types a workspace can associate (core + every custom slug), for the config UI.
export async function listAssociableObjects(
  tx: Prisma.TransactionClient,
): Promise<{ value: string; label: string }[]>;
```

`href` rules: `contact` → `/app/contacts/{id}`, `company` → `/app/companies/{id}`, `deal` → `/app/deals/{id}`, custom slug → `/app/o/{slug}/{id}`.

`exists` is computed against `deletedAt: null` for the soft-deletable tables (`contacts`, `companies`, `deals`, `custom_records`); a dangling/soft-deleted endpoint resolves to `exists: false` and is filtered out of the default panel view (and is a candidate for `cleanupAssociations`).

### 5.2 Reading + writing associations (`src/lib/associations.ts`)

```ts
export interface AssociationView {
  edgeId: string;
  associationTypeId: string;
  label: string;          // side-appropriate label for THIS record's perspective
  cardinality: string;
  direction: "outgoing" | "incoming"; // relative to the record being viewed
  other: ResolvedEndpoint;            // the record on the far side
}

// Every association touching (objectType, recordId), from BOTH directions, with the
// correct side-label applied (label when the record is the `from` side, inverseLabel
// when it is the `to` side). Skips edges whose far endpoint no longer exists.
export async function getAssociationsFor(
  tx: Prisma.TransactionClient,
  objectType: string,
  recordId: string,
): Promise<AssociationView[]>;

// Association types whose `fromObject` or `toObject` equals objectType — i.e. the set of
// link kinds available to "add" on this record's detail panel, each with the picker side
// (which object to pick) and the side-label to show.
export async function availableAssociationTypes(
  tx: Prisma.TransactionClient,
  objectType: string,
): Promise<{
  associationTypeId: string;
  label: string;          // side-appropriate label for THIS record
  cardinality: string;
  otherObject: string;    // the object type the user picks from
  pickFromSide: "to" | "from"; // which column this record's id goes into when adding
}[]>;
```

**Cardinality enforcement** lives in the write action (`createAssociation`, §5.4). Given a normalized directed edge `from → to` under a type with cardinality `c`:

- `many_to_many`: no count check.
- `one_to_many`: the **`from`** side may have many `to`s, but each `to` may have at most one `from` for this type. Before insert, reject if a row already exists with the same `associationTypeId` + `toType`/`toId` (i.e. the `to` record is already claimed). Practically: "a Company has many Contacts, but a Contact belongs to one Company (of this type)."
- `one_to_one`: reject if **either** endpoint already participates in an edge of this type (the `from` already has a `to`, or the `to` already has a `from`).

Rejections raise a typed error string (`"CARDINALITY:<message>"`) the action maps to a friendly message, mirroring the existing `"REQUIRED:…"` pattern in `src/lib/actions/objects.ts`.

### 5.3 Cascade cleanup (`src/lib/associations.ts`)

```ts
// Delete every edge touching (objectType, recordId) from either endpoint column.
// Called inside the same tx as the record soft-delete.
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
```

This is the structural fix for dangling pointers: deleting a record now *physically removes its edges* (a hard delete of the edge rows, even though the record itself is soft-deleted). It is wired into every record-delete action:

- `deleteContact` → `cleanupAssociations(tx, "contact", id)`
- `deleteCompany` → `cleanupAssociations(tx, "company", id)`
- `deleteDeal` → `cleanupAssociations(tx, "deal", id)`
- `deleteRecord` (custom) → `cleanupAssociations(tx, slug, id)` (slug derived from the looked-up `ObjectDefinition`)
- `deleteObjectDefinition` (custom) → before the object/records cascade, delete all edges + association types referencing that slug as `fromObject`/`toObject`/`fromType`/`toType` (§5.5).

Because reads also skip non-existent endpoints (`exists: false`), the system is robust even if a delete path is ever missed: cleanup is belt **and** braces.

### 5.4 Action module (`src/lib/actions/associations.ts`, `"use server"`)

Signatures mirror the existing object/company actions (positional bound args, `FormState` return for form actions, `void` for fire-and-forget detail-panel actions; `revalidatePath` on the affected detail pages; `canManageWorkspace(ctx.role)` gate on *type* management, but **not** on creating/removing edges — any member may link records, same as `addContactToCompany`).

```ts
export interface FormState { error?: string; }

// ── Association types (workspace settings; owner/admin only) ──
export async function createAssociationType(_prev: FormState, formData: FormData): Promise<FormState>;
  // fields: fromObject, toObject, label, inverseLabel, cardinality
export async function updateAssociationType(id: string, formData: FormData): Promise<void>;
  // editable: label, inverseLabel only (changing objects/cardinality after edges exist is disallowed; see §7)
export async function deleteAssociationType(id: string): Promise<void>;
  // cascades: ON DELETE CASCADE on record_associations drops all its edges.

// ── Edges (record detail panels; any member) ──
export async function addAssociation(
  recordType: string,      // the detail record's object type
  recordId: string,        // the detail record's id
  formData: FormData,      // { associationTypeId, otherId }
): Promise<void>;
  // Resolves direction from the AssociationType, normalizes to from→to, runs the
  // cardinality check, existence-checks both endpoints, inserts (skipDuplicates semantics
  // via the unique index → friendly no-op on duplicate). revalidates both detail pages.
export async function removeAssociation(
  edgeId: string,
  revalidateType: string,  // object type of the page initiating removal
  revalidateId: string,    // record id of that page (for revalidatePath)
): Promise<void>;
```

`addAssociation` direction normalization: look up the `AssociationType`. If `recordType === type.fromObject`, then `from = (recordType, recordId)` and `to = (type.toObject, otherId)`. If `recordType === type.toObject`, then `from = (type.fromObject, otherId)` and `to = (recordType, recordId)`. If the type is a self-association (`fromObject === toObject`, e.g. Contact↔Contact "reports to"), the panel disambiguates which side via the chosen association type's label vs inverseLabel; the action treats the detail record as the `from` side by default. Revalidate `/app/{contacts|companies|deals}/{id}` or `/app/o/{slug}/{id}` for **both** endpoints so the link appears on each side immediately.

### 5.5 Object-lifecycle hooks

- **Create object** (`createObjectDefinition`): reject reserved slugs `contact`/`company`/`deal` (the reserved-slug rule, §3) so a custom slug can never shadow a core token.
- **Delete object** (`deleteObjectDefinition`): inside the tx, before deleting the definition, run
  `tx.recordAssociation.deleteMany({ where: { OR: [{ fromType: slug }, { toType: slug }] } })`
  and `tx.associationType.deleteMany({ where: { OR: [{ fromObject: slug }, { toObject: slug }] } })`.
  (The `ObjectDefinition` cascade already removes its `CustomRecord`s; this removes the now-orphaned edges and types that referenced the slug.)

---

## 6. Relationship to existing relation fields + backfill

### 6.1 Decision: association types stay **separate** from `relation`/`relations` fields

New relation fields **do not** auto-create an `AssociationType`, and association types are not surfaced as custom fields. Rationale:

- **Different mental models.** A `relation` field is a *column on a form* (it has a `key`, a `position`, a `required` flag, and is edited inline with the record). An association is a *standalone edge* added from a panel and is inherently bidirectional with named inverses. Conflating them would force every association to invent a synthetic field key and a host object, and would make the inverse side a phantom field.
- **Non-breaking is cheaper.** Keeping them separate means zero change to `RecordForm`, `readValues`, `createRecord`/`updateRecord`, and the `values` JSON contract. The association layer is purely additive.
- **Clear forward guidance.** The association layer is the **recommended forward path** for *new* cross-object links (it is universal, enforced, and cleaned up). Relation fields remain supported for inline single/multi pickers on a form where that ergonomics is desired. We document this in the object-manager UI copy ("For links you manage from each record's Associations panel, define an association type instead.").

**Alternative considered (rejected):** auto-create one `AssociationType` per relation field and write an edge whenever the field changes. Rejected because it doubles the write path (JSON + edge can diverge), requires inferring `fromObject` (the host object's slug) and a label from the field, and complicates the field-delete path. Revisit only if we later decide to retire relation fields entirely.

### 6.2 Reconciliation during transition: the unified "Linked records" / "Associations" read

Two link sources will coexist:

1. **Edges** (`record_associations`) — the new model.
2. **JSON pointers** — `CustomFieldDef` relation fields, surfaced today by `getLinkedRecords` (inverse) and rendered inline by the record form (forward).

`getAssociationsFor` (§5.2) returns only edges. To avoid showing the same logical link twice and to keep the existing inverse view working, the detail-page composition is:

- **Associations panel** (new): renders `getAssociationsFor` (edges only) with add/remove controls.
- **Linked records card** (existing, `LinkedRecordsCard` + `getLinkedRecords`): keeps rendering inverse JSON-pointer links **read-only**, exactly as today, unchanged. It already labels each row with the source field (`fieldLabel`), so users can tell the two surfaces apart ("via field X" vs an association type).

The two never double-count because edges and JSON pointers are distinct stores; a backfilled link (§6.3) is the **only** case where the same logical relationship could appear in both. We resolve that by making backfill **opt-in and one-directional in messaging**: after backfill, the new edges are authoritative and the originating relation field is left intact but the workspace is advised (UI note) to manage that link from the Associations panel going forward. We deliberately do **not** auto-delete the JSON pointers (non-destructive), and `getLinkedRecords` continues to show them; the slight redundancy is acceptable and clearly labeled, versus the risk of destructive data loss.

### 6.3 Optional backfill (`scripts/backfill-associations.ts`, run manually per workspace; not a migration)

A standalone, idempotent script (invoked with explicit DB envs, run inside `withTenant` per workspace) that materializes existing JSON relation pointers into edges:

1. For each `ObjectDefinition` and each relation field `f` with a valid `relationTarget(f.options)` = `target`:
   - Ensure an `AssociationType` exists with `fromObject = def.slug`, `toObject = target`, `label = f.label`, `inverseLabel = "{def.nameSingular}"`, `cardinality = (f.type === "relations" ? "many_to_many" : "one_to_many")`. (Created once; `@@unique` makes re-runs no-ops.)
   - For each `CustomRecord` of `def`, read `values[f.key]`; for each pointed id (string or array), if the endpoint resolves (`exists`), upsert an edge `from = (def.slug, record.id)`, `to = (target, pointedId)`. The unique index makes re-insertion a no-op.
2. The script prints a per-workspace summary (types created, edges created, pointers skipped as dangling).

Backfill is **never** run automatically by `migrate deploy` — it is a deliberate operator action, because it creates user-visible association types and is workspace-scoped. The migration itself only creates empty tables.

---

## 7. UI

### 7.1 Association-type config (workspace settings)

New route `src/app/app/settings/associations/page.tsx` (owner/admin only; `canManageWorkspace` gate → `notFound()` like `objects/[slug]`):

- A **list** of existing association types: `{fromObject label} —[ label / inverseLabel ]→ {toObject label}` with a cardinality badge (reusing `Badge` like the field list in `objects/[slug]/page.tsx`) and a `DeleteButton` (`confirmText` warns that all edges of this type will be removed).
- A **create form** (new client component `src/components/app/association-type-form.tsx`, modeled on `field-form.tsx`): two `Select`s populated from `listAssociableObjects` (core + custom), two text `Input`s for label / inverseLabel, a cardinality `Select`. Submits `createAssociationType`.
- **Edit** is label/inverseLabel-only (inline, like the object rename form). `fromObject`/`toObject`/`cardinality` are **immutable after creation** to avoid orphaning or invalidating existing edges (changing cardinality could violate already-stored counts). Doc copy states this; the form for editing hides those fields.

Add a settings entry/link to this page wherever the settings index lists sections (`src/app/app/settings/page.tsx`).

### 7.2 Associations panel on record detail pages

A single shared client/server component pair used by **all four** detail page types:

- `src/components/app/associations-panel.tsx` (client) — renders grouped `AssociationView[]` by `label`, each row a link to `other.href` titled `other.title` with a remove `X` (form → `removeAssociation`), and a per-association-type "add" row: a `Select` (when ≤ a threshold) or `MultiSelect`-style picker of candidate records for `otherObject`, plus an Add button (form → `addAssociation`). This mirrors the Company→Contacts add/remove block in `companies/[id]/page.tsx` almost line-for-line, generalized.
- The detail pages fetch the data server-side inside their existing `withTenant` block:
  - `views = await getAssociationsFor(tx, <type>, id)`
  - `addable = await availableAssociationTypes(tx, <type>)`, and for each, candidate options via `relationOptions(tx, otherObject)` (reused as-is — it already returns `{id,label}` for any core token or custom slug).
- Wired into:
  - `src/app/app/companies/[id]/page.tsx` (alongside the existing bespoke Contacts/Deals cards and `LinkedRecordsCard`)
  - `src/app/app/contacts/[id]/page.tsx`
  - `src/app/app/deals/[id]/page.tsx`
  - `src/app/app/o/[slug]/[id]/page.tsx` (custom records)

The existing bespoke cards (Company→Contacts, Company→Deals, Deal→Contacts) and `LinkedRecordsCard` are left in place; the Associations panel is an additional card. This keeps the change non-breaking and lets us migrate bespoke pairs into association types later without UI churn.

### 7.3 Bidirectional display

Bidirectionality is automatic: `getAssociationsFor` queries `record_associations` from *both* the `from*` and `to*` indexes for the viewed record, and applies `label` when the record is the `from` side and `inverseLabel` when it is the `to` side (the `direction` field records which). So a single stored edge "Acme (company) → Jane (contact)" under type label "Employees" / inverse "Employer" renders as **Employees: Jane** on Acme's page and **Employer: Acme** on Jane's page — one row, two views.

---

## 8. Error Handling

| Condition | Where | Behavior |
|---|---|---|
| Cardinality violation | `addAssociation` | Throw `"CARDINALITY:<msg>"`; action no-ops the write and (panel is `void`-returning) the page revalidates unchanged. For form-returning surfaces, map to `{ error }`. |
| Duplicate edge | `addAssociation` | Unique index → caught, treated as idempotent no-op (no error shown). |
| Endpoint missing/soft-deleted at write | `addAssociation` | Existence check fails → no-op (the picker only offers `deletedAt: null` records, so this is a race guard). |
| Endpoint missing at read | `getAssociationsFor` | `resolveEndpoints` returns `exists:false`; row filtered out of the panel. |
| Reserved slug on object create | `createObjectDefinition` | Returns `{ error: "That name is reserved." }`. |
| Editing immutable type fields | `updateAssociationType` | Only label/inverseLabel are read from the form; other fields ignored. |
| Non-admin hits config route/action | settings page + type actions | `notFound()` / early return, matching `objects/[slug]`. |
| Tenant boundary | RLS | A cross-tenant id is invisible (policy returns zero rows); writes blocked by the `WITH CHECK` + trigger. |

---

## 9. Testing Strategy

Following the repo's existing test conventions (integration tests run inside `withTenant`, asserting RLS + behavior). Each is independently runnable.

1. **RLS isolation.** Insert an `AssociationType` and `RecordAssociation` in workspace A; assert workspace B's tenant context reads zero rows and cannot insert an edge naming A's records.
2. **Cardinality.**
   - `one_to_one`: second edge on either endpoint rejected.
   - `one_to_many`: many `to`s for one `from` allowed; a second `from` for the same `to` rejected.
   - `many_to_many`: multiple both ways allowed; exact duplicate rejected (unique index).
3. **Bidirectional read.** Create one edge; assert it appears with `label` on the `from` page query and `inverseLabel` on the `to` page query, with correct `direction`.
4. **Cascade cleanup.** Soft-delete each endpoint kind (contact, company, deal, custom record) and assert its edges are gone; soft-delete an object definition and assert its types + edges are gone.
5. **Dangling resolution.** Manually orphan an edge (delete endpoint row bypassing cleanup), assert `getAssociationsFor` filters it (`exists:false`).
6. **Backfill idempotency.** Seed JSON-pointer relations; run backfill twice; assert types + edges created once, dangling pointers skipped, JSON untouched.
7. **Latent `relations` bug.** `addField` with `type:"relations"` persists `options.target`; assert `relationTarget` resolves and the field appears in `getLinkedRecords`.
8. **Reserved slug.** `createObjectDefinition` with name yielding slug `contact`/`company`/`deal` is rejected.
9. **End-to-end action.** `addAssociation` from each side normalizes direction to one row; `removeAssociation` deletes it; both detail pages revalidated.

---

## 10. Migration / Rollout Plan

1. **Schema + migration (additive, zero downtime).** Add the two models; generate `23_record_associations`; hand-append the RLS block + CHECK; wake Neon; `migrate deploy`. No existing table is touched, so deploy is safe to run before the app code ships.
2. **Library + actions.** Ship `src/lib/associations.ts` and `src/lib/actions/associations.ts`; wire `cleanupAssociations` into the four delete actions and `deleteObjectDefinition`; fix the `relations` target bug and add the reserved-slug guard.
3. **UI.** Ship the settings config page + the shared Associations panel; wire the panel into the four detail pages.
4. **Optional backfill.** Per-workspace, on request, run `scripts/backfill-associations.ts`. Reversible by deleting the created association types (cascades the edges); JSON pointers are untouched.
5. **Rollback.** Because everything is additive: revert app code (panel + actions disappear, relation fields keep working). The tables can be left in place (empty/unused) or dropped with a follow-up migration; no data migration is required to roll back.

---

## 11. Open Questions

1. **Self-associations** (`fromObject === toObject`, e.g. Contact "reports to" Contact). The model supports them; the panel default-treats the viewed record as the `from` side. Confirm whether the v1 UI should expose a from/to toggle when adding a self-association, or defer self-associations to a later iteration.
2. **Should backfilled relation fields eventually be hidden** from the record form once an association type covers them, or remain editable indefinitely? Current spec keeps them editable (non-destructive); confirm.
3. **Bespoke core pair unification.** This spec leaves `Contact.companyId`, `Deal.companyId`, and `DealContact` as the source of truth. Confirm we are not unifying them now (the spec assumes not).
4. **Picker scale.** `relationOptions` caps at 500 rows; for large workspaces the add-picker may need search/pagination. Acceptable for v1?
