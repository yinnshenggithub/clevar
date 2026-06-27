# Custom fields on built-in objects — design

**Date:** 2026-06-27
**Status:** approved (brainstorming) — pending implementation plan
**Author:** Clevar build session

## Problem

Custom objects in Clevar have a full user-defined-field system: `ObjectDefinition` +
`CustomFieldDef` (schema) + `CustomRecord` (JSON values), a rich 14-type field set
(`src/lib/custom-objects.ts`), a dynamic renderer (`record-form.tsx`), and a field-def
editor (`field-form.tsx`).

The **built-in** objects — Contact, Company, Deal — cannot have user-defined fields. They
already carry an unused `customFields Json @default("{}")` column (only `social-inbox.ts`
writes `source`/`formId` into Contact's). The storage slot exists; what's missing is a
*definition layer*, management UI, and form/detail rendering on top of it.

**Goal:** let a workspace define custom fields on the built-in objects — Contact, Company,
Deal, **and** Task & Note — reusing the existing field system end-to-end.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Field-def model | **Unify** — extend `CustomFieldDef` with an object-type token; core + custom objects share one field system |
| Objects in scope | Contact, Company, Deal, **Task, Note** |
| Surfaces | Forms + detail view (baseline) **plus** list columns, CSV import/export, global search, AI agent context |
| Management UI | Single `/app/settings/fields` page with an object picker (mirrors `/app/settings/associations`) |
| Field types | All 14 (parity with custom objects); `relation`/`relations` kept despite Associations overlap |
| Storage | JSON column (`customFields` / `values`) — no EAV table |
| Packaging | One spec, two phases |

## Object-type token

Field definitions are addressed by a **token** string, exactly the convention the
Associations feature already uses (`AssociationType.fromObject` is `"contact"|"company"|"deal"`
or a custom slug):

- Core: `"contact" | "company" | "deal" | "task" | "note"`
- Custom: the object's `slug`

Custom-object field defs additionally keep their `objectDefinitionId` FK; core defs set it
`null`. Lookup is **always by token**, so core and custom share one code path.

---

## Phase 1 — MVP (end-to-end usable)

### 1. Data model — migration `26_custom_fields_core`

**Alter `custom_field_defs`:**
- Add `object_type text` (token).
- Make `object_definition_id` **nullable**.
- Backfill: `UPDATE custom_field_defs SET object_type = od.slug FROM object_definitions od WHERE od.id = custom_field_defs.object_definition_id;`
- Replace unique `@@unique([objectDefinitionId, key])` with **`@@unique([workspaceId, objectType, key])`**.
  Rationale: with nullable `objectDefinitionId`, Postgres treats NULLs as distinct, so two
  core fields keyed `tier` would both insert under the old constraint. The token is always
  non-null, so `(workspaceId, objectType, key)` is the correct guard.
- Add `@@index([workspaceId, objectType, position])`.
- `objectDefinitionId` relation to `ObjectDefinition` becomes optional.

**Add `customFields Json @default("{}")` to `tasks` and `notes`.** Both tables are already
RLS-enabled (`prisma/migrations/1_rls` `tenant_tables` array includes `notes`; `tasks` gets
RLS in `15_tasks_activity`). Adding a column to an existing RLS table needs **no new RLS
block** — the policy and `set_workspace_id` trigger already apply.

Prisma `schema.prisma` `CustomFieldDef`:
```prisma
model CustomFieldDef {
  id                 String            @id @default(uuid()) @db.Uuid
  workspaceId        String            @map("workspace_id") @db.Uuid
  objectType         String            @map("object_type")          // token
  objectDefinitionId String?           @map("object_definition_id") @db.Uuid  // null for core
  key                String
  label              String
  type               String
  required           Boolean           @default(false)
  defaultValue       String?           @map("default_value")
  options            Json              @default("{}")
  position           Int               @default(0)
  createdAt          DateTime          @default(now()) @map("created_at") @db.Timestamptz
  workspace          Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  objectDefinition   ObjectDefinition? @relation(fields: [objectDefinitionId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, objectType, key])
  @@index([workspaceId, objectType, position])
  @@map("custom_field_defs")
}
```

Migration workflow follows the Neon/RLS process: probe port 5432 to wake Neon, `prisma
migrate diff` → hand-append nothing (no new RLS needed; backfill SQL added manually) →
`prisma migrate deploy`.

### 2. Object registry — `src/lib/objects-registry.ts`

A single authority describing every targetable object:

```ts
interface ObjectMeta {
  token: string;            // "contact" | ... | <slug>
  label: string;            // "Contact"
  pluralLabel: string;
  kind: "core" | "custom";
  reservedKeys: string[];   // column names a custom key must not collide with
  href?: (id: string) => string;
}
```

- Core objects are hardcoded with their `reservedKeys`:
  - contact: `firstName,lastName,email,phone,jobTitle,companyId`
  - company: `name,domain,industry`
  - deal: `title,amount,currency,status,pipelineId,stageId,companyId,expectedCloseAt`
  - task: `title,body,status,dueAt,assigneeId,parentType,parentId`
  - note: `body,parentType,parentId`
- Custom objects are loaded from `ObjectDefinition` (token = slug, no reserved keys beyond `id`).
- `listObjects(tx)` returns core + custom; `getObjectMeta(tx, token)` resolves one.

Used by: settings UI, field CRUD validation, `relationOptions` target list.

### 3. Field CRUD — generalize `src/lib/actions/objects.ts`

Change the field actions to key off **token** instead of `objectDefinitionId`:
- `addField(token, prev, formData)` — validate token ∈ registry; resolve `objectDefinitionId`
  (custom) or `null` (core); enforce reserved-key collision + key uniqueness; set
  `objectType = token`. Existing `FIELD_TYPES` / `options` / `supportsDefault` logic is
  unchanged.
- `updateField(fieldId, formData)` — **new**: rename label, edit choices/default/required,
  reorder. (Type changes disallowed in v1 to avoid value migration — flag in UI.)
- `deleteField(fieldId, token)` — unchanged behaviour, revalidate the right path.
- `reorderFields(token, orderedIds)` — **new**: persist `position`.
- `listFields(tx, token)` helper used everywhere.

`revalidatePath` targets: `/app/settings/fields` plus the affected object's pages
(`/app/contacts` etc., or `/app/objects/<slug>`).

### 4. Management UI — `/app/settings/fields`

- Server page loads `listObjects` + selected object's fields.
- Layout mirrors `/app/settings/associations`: left rail = object picker (Contact, Company,
  Deal, Task, Note, then custom objects); right = field list with add (`field-form.tsx`),
  inline edit, delete, drag-reorder.
- `field-form.tsx` change: replace `objectId` prop with `token`; call `addField(token, …)`.
  Everything else (type select, choices, relation target, default, required) is reused as-is.
- Gated by `canManageWorkspace(role)` (owners/admins).
- The existing custom-object field manager at `/app/objects/[slug]` stays and calls the same
  actions (token = slug). Add a link from there to the unified page; no behavioural change.
- Settings index (`/app/settings/page.tsx`) gets a "Fields" entry.

### 5. Forms + persistence

**Shared input renderer.** Extract the field-input rendering out of `record-form.tsx` into a
reusable `<CustomFieldset fields={RecordFieldDef[]} defaults={...} />` (client). `record-form.tsx`
consumes it (no behaviour change for custom records); core forms embed it as a "Custom fields"
section below their built-in inputs:
- `contact-form.tsx`, `company-form.tsx`, `deal-form.tsx` — embed `<CustomFieldset>`.
- `task-composer.tsx` — embed `<CustomFieldset>` (tasks are created via the composer).
- **Note** — notes are body-only and have **no edit form** today. Phase 1 adds Note field
  *definitions + storage + settings UI* but **defers form-embedding** until a Note has an
  edit surface; flagged below as an open sub-decision. (Storage/defs still exist so values
  set via API/import/agent persist.)

Server pages that render these forms load `listFields(token)` + `relationOptions` for any
relation fields and pass `RecordFieldDef[]` down.

**Shared value parsing.** Lift `readValues` + `missingRequired` from `objects.ts` into
`src/lib/field-values.ts` (pure, no `server-only` DB dependency). `objects.ts` imports them
(no behaviour change for custom records).

**Persistence in core save actions** (`createContact`/`updateContact`, and the company,
deal, task analogues):
1. Load `listFields(token)`.
2. `const cf = readValues(fields, formData, isCreate)`.
3. `missingRequired(fields, cf)` → return friendly error if any.
4. **Merge** into the column: `customFields: { ...existing, ...cf }`. Merge (not overwrite)
   preserves keys the form doesn't own — e.g. `social-inbox`'s `source`/`formId`. On create,
   `existing` is `{}`.
5. Write `customFields` in the same `tx.<model>.create/update`.

### 6. Detail read view

A "Custom fields" card on each detail page (`RecordDetailLayout` already provides the
3-column shell on contact/company/deal):
- For each defined field, show label + `formatFieldValue(type, value)`.
- Relation/relations: resolve stored IDs to titles via `relationOptions`/`getLinkedRecords`
  (same resolution custom records use).
- Hide the card when no fields are defined for the object.

---

## Phase 2 — surfaces

### 7a. List/table columns
- Append defined custom fields as columns to the list views (Contacts/Companies/Deals; Tasks
  if a list exists). The list components take a simple `columns` string array
  (`["Name","Email","Phone","Company"]`) + row cells, so this is additive.
- v1 renders from the already-loaded JSON; sorting by a custom field is done in-app on the
  fetched page (capped result set). Note for scale: per-field expression indexes or generated
  columns (see Alternatives) — out of scope here, logged as a known cap.

### 7b. CSV import/export — `src/lib/actions/import.ts`
- Import: offer custom-field columns in the column-mapping step (match by label, fallback to
  key); parse through the shared `readValues` coercion; merge into `customFields`.
- Export: include each defined custom field as a column (header = label), formatted via
  `formatFieldValue`.

### 7c. Global search — `src/lib/actions/search.ts`
- Add a **GIN index** on each core `custom_fields` jsonb column in a Phase 2 migration (`27`),
  keeping the Phase 1 migration focused on the model change.
- Extend `globalSearch` to scan core records' custom-field values, reusing the exact capped
  JSON-scan pattern already implemented for custom records (`Object.values(...).some(... includes ...)`).
  Keep the existing column `OR` filters; add custom-value matching on the fetched candidates.

### 7d. AI agent context
- When serializing a record for an agent (record context builder + `buildActionTools`'s
  `update-contact-field`), include defined custom fields as `label: value` pairs so replies
  can read them.
- Extend the `update-contact-field` action tool (and company/deal equivalents) to accept a
  custom-field key, validated against `listFields(token)` and coerced via `readValues`, then
  merged into `customFields`. Consequential-action gating stays in code (per security research
  in `docs/agent-rag-security-research.md`) — the model proposes, the server validates the key
  exists and the value type fits.

---

## Alternatives considered

- **Separate `CoreFieldDef` table** instead of extending `CustomFieldDef`. Rejected: duplicates
  the field-def concept and forces two renderers/CRUD paths. Unify chosen.
- **Normalized EAV value table** instead of JSON columns. Rejected for v1: bigger change,
  breaks consistency with custom records, and the JSON columns already exist. EAV remains the
  long-term option if per-field SQL querying/sorting becomes a bottleneck.
- **System `ObjectDefinition` rows for core objects** (everything-is-an-object, the Twenty
  model). Rejected: core objects keep bespoke columns + bespoke pages, so a parallel
  ObjectDefinition would be a confusing second source of truth. The token approach gets the
  unification benefit without the refactor.

## Risks & mitigations

- **Key collisions** with real columns → reserved-key guard in the registry (§2), enforced in
  `addField`.
- **Type change after data exists** → disallowed in v1 (UI hint); revisit with a value-migration
  step later.
- **JSON value drift** (e.g. a field deleted but values linger) → harmless; reads are
  def-driven, orphan keys are ignored. Optional cleanup deferred.
- **Relation-field ↔ Associations overlap** → both coexist (already true for custom objects).
  Documented; no enforcement unifying them in this work.
- **Note form-embedding gap** → see open sub-decision.

## Out of scope

- Per-field permissions / visibility rules.
- Computed/formula fields, field dependencies, conditional visibility.
- Unique/validated-format constraints beyond required + type coercion.
- Field-type migration of existing values.
- Backfill scripts for existing records (new fields default to empty/`defaultValue`).

## Open sub-decisions (carry into the plan)

1. **Note custom-field input surface.** Notes have only a body and no edit form. Options:
   (a) Phase 1 ships Note *defs + storage + settings* only, form-embed deferred (recommended);
   (b) add a minimal Note edit form now. Default: (a).

## Test plan (high level)

- Unit: `readValues`/`missingRequired` for each field type incl. multi-value and defaults;
  reserved-key + uniqueness rejection in `addField`; registry resolution.
- Integration: define a field per type on Contact → create/edit → value round-trips in
  `customFields`; required enforcement; merge preserves `source`/`formId`.
- RLS: a field def and a custom value created in workspace A are invisible to workspace B.
- Surfaces (Phase 2): CSV round-trip of a custom column; search finds a custom value; agent
  reads and sets a custom field with server-side key/type validation.
