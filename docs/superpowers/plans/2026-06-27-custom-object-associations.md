# Record Associations — Implementation Plan

**Status:** Draft for review · **Date:** 2026-06-27 · **Spec:** [`2026-06-27-custom-object-associations-design.md`](../specs/2026-06-27-custom-object-associations-design.md)

Bite-sized, ordered tasks. Each is independently testable and ends with a verify step. Follow existing repo patterns and naming. Do **not** commit/push — the parent process handles git. Do **not** run migrations against prod without the Neon-wake step.

**Standing build/verify commands** (referenced as "BUILD" below):

```bash
npx prisma generate
DATABASE_URL=... DIRECT_URL=... AUTH_SECRET=...(32+chars) NEXT_PUBLIC_APP_URL=... npx next build
```

**Standing migration commands** (referenced as "MIGRATE" below):

```bash
# 1. generate raw SQL
npx prisma migrate diff \
  --from-url "$POSTGRES_URL_NON_POOLING" \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/23_record_associations/migration.sql
# 2. hand-append the RLS + CHECK block (task 2)
# 3. wake Neon (TCP probe :5432), then:
npx prisma migrate deploy
```

---

## Task 1 — Schema models

**File:** `prisma/schema.prisma`
**Do:**
- In the custom-objects section (after `CustomRecord`), add the `AssociationType` and `RecordAssociation` models exactly as in spec §4.1.
- Add back-relations to `Workspace`: `associationTypes AssociationType[]` and `recordAssociations RecordAssociation[]` (next to the existing `customRecords` line).
**Verify:** `npx prisma format && npx prisma validate` succeeds. `npx prisma generate` produces `AssociationType` / `RecordAssociation` delegates. Do **not** deploy yet.

## Task 2 — Migration + RLS block

**File:** `prisma/migrations/23_record_associations/migration.sql` (new dir)
**Do:**
- Run MIGRATE step 1 to generate the CreateTable/Index/FK SQL.
- Hand-append: the cardinality `CHECK` constraint and the `DO $$ … FOREACH` RLS block from spec §4.2 (copied shape from `prisma/migrations/8_custom_objects/migration.sql`). Confirm the generated index/constraint names match the spec or adjust the spec note to the generated names — names are cosmetic, the RLS block references table names only.
**Verify:** Eyeball the file: both tables get `ENABLE`+`FORCE` RLS, a `tenant_isolation` policy, and a `set_workspace_id` BEFORE INSERT trigger. Run MIGRATE steps 3 (wake Neon) + `migrate deploy` against the dev/Neon DB. Confirm with a quick check that RLS is enabled:
```bash
psql "$POSTGRES_URL_NON_POOLING" -c "\d+ record_associations" -c "SELECT relrowsecurity FROM pg_class WHERE relname IN ('association_types','record_associations');"
```
(both `relrowsecurity = t`).

## Task 3 — Resolution + query library

**File:** `src/lib/associations.ts` (new; `import "server-only"`, no `"use server"` — mirrors `src/lib/object-data.ts`)
**Do:** Implement, per spec §5.1–5.3:
- `ObjectTypeToken`, `EndpointRef`, `ResolvedEndpoint`, `AssociationView` types.
- `isCoreObject(t)` → `t === "contact" || t === "company" || t === "deal"`.
- `resolveEndpoints(tx, refs)`: group refs by `objectType`; one batched query per group (`contact`/`company`/`deal` by id-in with `deletedAt:null`; custom slugs via `ObjectDefinition` + `CustomRecord` reusing the title logic already in `relationOptions`). Build `title`/`href`/`nameSingular`/`exists`. Return a `Map` keyed `${objectType}:${recordId}`.
- `listAssociableObjects(tx)`: `[{value:"contact",label:"Contact"},{company},{deal}]` (reuse `CORE_RELATION_TARGETS` from `src/lib/custom-objects.ts`) concatenated with every `ObjectDefinition` `{value:slug,label:nameSingular}`.
- `getAssociationsFor(tx, objectType, recordId)`: query `recordAssociation` where `(fromType,fromId)` OR `(toType,toId)` match; join `associationType`; build the far-endpoint `EndpointRef` list; `resolveEndpoints`; map to `AssociationView[]` applying `label` (record is `from`) or `inverseLabel` (record is `to`) and `direction`; drop rows where `other.exists === false`.
- `availableAssociationTypes(tx, objectType)`: `associationType` where `fromObject = objectType` OR `toObject = objectType`; for each emit `{associationTypeId,label(side-appropriate),cardinality,otherObject,pickFromSide}`.
- `cleanupAssociations(tx, objectType, recordId)`: the `deleteMany` from spec §5.3.
**Verify:** BUILD passes (type-checks). Add a throwaway unit assertion or `tsx` snippet exercising `isCoreObject` + the `href` switch.

## Task 4 — Fix latent `relations` target bug + reserved slugs

**File:** `src/lib/actions/objects.ts`
**Do:**
- In `addField`, change the relation branch so `options.target` is stored for **both** link types. Replace `} else if (type === "relation") {` with `} else if (isRelationType(type)) {` (`isRelationType` is already imported). Keep the empty-target guard.
- In `createObjectDefinition`, after computing `slug`, reject reserved tokens: if `["contact","company","deal"].includes(slug)` return `{ error: "That name is reserved. Choose another." }`.
**Verify:** BUILD passes. Manually create a `relations` field in the object manager and confirm the `→ target` badge now shows (it reads `relationTarget(f.options)` in `objects/[slug]/page.tsx`). Manually attempt to create an object named "Contact" → rejected.

## Task 5 — Action module

**File:** `src/lib/actions/associations.ts` (new; `"use server"`)
**Do:** Implement per spec §5.4, copying the shape of `src/lib/actions/objects.ts` / `companies.ts`:
- `FormState`.
- `createAssociationType(_prev, formData)`: `requireAuth` + `canManageWorkspace` gate; read `fromObject,toObject,label,inverseLabel,cardinality`; validate (zod) non-empty + cardinality ∈ union + both objects ∈ `listAssociableObjects`; `withTenant` create; `revalidatePath("/app/settings/associations")`.
- `updateAssociationType(id, formData)`: admin gate; read only `label`/`inverseLabel`; update; revalidate.
- `deleteAssociationType(id)`: admin gate; delete (edges cascade via FK); revalidate.
- `addAssociation(recordType, recordId, formData)`: `requireAuth` (any member); read `associationTypeId,otherId`; `withTenant`: load type, normalize direction (spec §5.4), existence-check both endpoints via `resolveEndpoints`, run cardinality check (throw `"CARDINALITY:…"`), insert (catch unique-violation → no-op); `revalidatePath` both endpoints' detail pages (derive href base from `isCoreObject`/slug).
- `removeAssociation(edgeId, revalidateType, revalidateId)`: `withTenant` `deleteMany({where:{id:edgeId}})`; revalidate the initiating page (+ optionally resolve the far side and revalidate it too).
**Verify:** BUILD passes. (Behavioral tests in Task 9.)

## Task 6 — Wire cascade cleanup into deletes

**Files:** `src/lib/actions/contacts.ts`, `src/lib/actions/deals.ts`, `src/lib/actions/companies.ts`, `src/lib/actions/objects.ts`
**Do:** Import `cleanupAssociations` from `@/lib/associations`. Inside each delete action's existing `withTenant` block, after the soft-delete update, call it:
- `deleteContact` → `await cleanupAssociations(tx, "contact", id)`
- `deleteCompany` → `await cleanupAssociations(tx, "company", id)`
- `deleteDeal` → `await cleanupAssociations(tx, "deal", id)`
- `deleteRecord(slug,id)` → look up the def's slug already have it (`slug` arg) → `await cleanupAssociations(tx, slug, id)`
- `deleteObjectDefinition(id)` → before `tx.objectDefinition.delete`, resolve its `slug`, then `tx.recordAssociation.deleteMany({where:{OR:[{fromType:slug},{toType:slug}]}})` and `tx.associationType.deleteMany({where:{OR:[{fromObject:slug},{toObject:slug}]}})`.
**Verify:** BUILD passes. Manually: create an edge, delete one endpoint, confirm the edge row is gone (`SELECT count(*) FROM record_associations`).

## Task 7 — Association-type config UI (settings)

**Files:**
- `src/components/app/association-type-form.tsx` (new, client; model on `field-form.tsx`)
- `src/app/app/settings/associations/page.tsx` (new; model on `objects/[slug]/page.tsx`)
- `src/app/app/settings/page.tsx` (edit: add a link/card to the new page)
**Do:**
- Form: two `Select`s (options from a prop fed by `listAssociableObjects`), two `Input`s (label/inverseLabel), one cardinality `Select`; submit `createAssociationType` via `useActionState` (like `field-form`).
- Page: `requireAuth` + `canManageWorkspace` → else `notFound()`. `withTenant`: load `associationType.findMany` + `listAssociableObjects`. Render list (label/inverse/cardinality `Badge` + `DeleteButton` with warning `confirmText`) + the create form. Use `PageHeader`, `Card`.
- Settings index: add an "Associations" entry pointing at `/app/settings/associations`.
**Verify:** BUILD passes. Visit `/app/settings/associations` as admin → create a Company↔Contact type (label "Employees", inverse "Employer", `one_to_many`) → appears in the list. As a non-admin, the route 404s.

## Task 8 — Shared Associations panel component

**File:** `src/components/app/associations-panel.tsx` (new, client)
**Do:** Props: `record: {type,id}`, `views: AssociationView[]`, `addable: {associationTypeId,label,cardinality,otherObject, options:{id,label}[]}[]`. Render, generalizing the Company→Contacts block in `companies/[id]/page.tsx`:
- Group `views` by `label`; each row → link to `other.href` (title `other.title`) + remove form (`removeAssociation.bind(null, edgeId, record.type, record.id)`).
- For each `addable` type: an add form → `Select` of `options` (or `MultiSelect` styling when long) + Add button → `addAssociation.bind(null, record.type, record.id)` with hidden `associationTypeId` and the picked `otherId`.
- Empty state per existing copy conventions.
Wrap in a `Card` titled "Associations".
**Verify:** BUILD passes. (Rendered in Task 9 wiring.)

## Task 9 — Wire panel into the four detail pages + behavioral checks

**Files:** `src/app/app/companies/[id]/page.tsx`, `src/app/app/contacts/[id]/page.tsx`, `src/app/app/deals/[id]/page.tsx`, `src/app/app/o/[slug]/[id]/page.tsx`
**Do:** In each page's existing `withTenant` block, after current loads add:
```ts
const assocViews = await getAssociationsFor(tx, <typeToken>, id);
const addable = await Promise.all(
  (await availableAssociationTypes(tx, <typeToken>)).map(async (a) => ({
    ...a, options: await relationOptions(tx, a.otherObject),
  })),
);
```
(`<typeToken>` = `"company"`/`"contact"`/`"deal"`/`slug`.) Pass to `<AssociationsPanel record={{type:<typeToken>,id}} views={assocViews} addable={addable} />`, rendered as an extra `Card` (leave existing cards + `LinkedRecordsCard` untouched). Import `getAssociationsFor`, `availableAssociationTypes` from `@/lib/associations` and `relationOptions` from `@/lib/object-data`.
**Verify:** BUILD passes. Manual end-to-end:
1. From a Company detail page, add an "Employees" link to a Contact → it appears under "Employees" on the Company and as "Employer" on that Contact's page (bidirectional).
2. Remove it from either side → disappears on both.
3. Cardinality: with `one_to_many`, adding a second Company as "Employer" to the same Contact is rejected (no-op).
4. Delete the Contact → the Company's Associations panel no longer lists it.
5. Repeat one add/remove on a custom-object record (`/app/o/{slug}/{id}`).

## Task 10 — Optional backfill script

**File:** `scripts/backfill-associations.ts` (new; standalone, run with explicit DB envs)
**Do:** Implement spec §6.3: iterate object definitions + relation fields with valid targets; ensure the matching `AssociationType` (idempotent via `@@unique`); upsert edges from JSON pointers, skipping dangling; print a per-workspace summary. Wrap per-workspace in `withTenant`. **Not** invoked by `migrate deploy`.
**Verify:** Against a dev workspace with existing relation data: run once (edges created), run again (no new rows — idempotent), confirm JSON `values` untouched and dangling pointers reported as skipped.

## Task 11 — Tests

**Files:** under the repo's existing test location (mirror an existing integration test's harness/`withTenant` usage)
**Do:** Implement spec §9 cases 1–9 (RLS isolation, three cardinality modes, bidirectional read, cascade cleanup incl. object-definition delete, dangling resolution, backfill idempotency, the `relations` bug fix, reserved-slug rejection, end-to-end add/remove).
**Verify:** The test suite passes. Then a final full BUILD.

---

## Final verification checklist

- [ ] `npx prisma validate` + `generate` clean.
- [ ] `migrate deploy` applied `23_record_associations`; both tables show `relrowsecurity = t`, have `tenant_isolation` + `set_workspace_id`.
- [ ] BUILD (`next build`) passes.
- [ ] Tests (spec §9) green.
- [ ] Manual: bidirectional add/remove works on all four detail page types; cardinality enforced; delete cleans up edges; `relations` field now carries a target; reserved slugs rejected.
- [ ] No reference anywhere (code, copy, docs) to any upstream engine/vendor — neutral "CRM"/"the app" naming only.
