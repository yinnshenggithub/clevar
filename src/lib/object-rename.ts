import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Identifier cascade helpers. Custom-field keys and custom-object slugs are the
 * addressable code for a property (object.key). When either is renamed, the
 * change must follow through everywhere the code is referenced — stored record
 * values, association edges, and relation targets — so the qualified key stays
 * valid end to end.
 */

/** Physical table for a core object token's `custom_fields` JSON bag. */
const CORE_TABLE: Record<string, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  task: "tasks",
  note: "notes",
};

/**
 * Rename a stored custom-field key across every record of its object, moving the
 * value under the old key to the new key in the JSON bag. Core objects use their
 * table's `custom_fields`; custom objects use `custom_records.values`.
 */
export async function renameFieldValues(
  tx: Prisma.TransactionClient,
  objectType: string,
  objectDefinitionId: string | null,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) return;
  if (objectDefinitionId) {
    await tx.$executeRawUnsafe(
      `UPDATE custom_records
         SET values = (values - $1) || jsonb_build_object($2::text, values->$1)
       WHERE object_definition_id = $3::uuid AND jsonb_exists(values, $1)`,
      oldKey,
      newKey,
      objectDefinitionId,
    );
    return;
  }
  const table = CORE_TABLE[objectType];
  if (!table) return;
  await tx.$executeRawUnsafe(
    `UPDATE ${table}
       SET custom_fields = (custom_fields - $1) || jsonb_build_object($2::text, custom_fields->$1)
     WHERE jsonb_exists(custom_fields, $1)`,
    oldKey,
    newKey,
  );
}

/**
 * Cascade a custom-object slug rename through every reference: the object's own
 * field defs (`object_type`), association edges + types, relation-field targets
 * pointing at it, and finally the definition row itself.
 */
export async function cascadeObjectSlug(
  tx: Prisma.TransactionClient,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  if (oldSlug === newSlug) return;
  await tx.customFieldDef.updateMany({ where: { objectType: oldSlug }, data: { objectType: newSlug } });
  await tx.recordAssociation.updateMany({ where: { fromType: oldSlug }, data: { fromType: newSlug } });
  await tx.recordAssociation.updateMany({ where: { toType: oldSlug }, data: { toType: newSlug } });
  await tx.associationType.updateMany({ where: { fromObject: oldSlug }, data: { fromObject: newSlug } });
  await tx.associationType.updateMany({ where: { toObject: oldSlug }, data: { toObject: newSlug } });
  // Relation fields (on any object) that point at this slug via options.target.
  await tx.$executeRawUnsafe(
    `UPDATE custom_field_defs
       SET options = jsonb_set(options, '{target}', to_jsonb($2::text))
     WHERE options->>'target' = $1`,
    oldSlug,
    newSlug,
  );
  await tx.objectDefinition.updateMany({ where: { slug: oldSlug }, data: { slug: newSlug } });
}
