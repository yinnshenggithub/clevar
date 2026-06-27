-- Custom fields on built-in objects: address field defs by an object_type token
-- (contact | company | deal | task | note | <custom slug>) so core and custom
-- objects share one field system. No new RLS block — custom_field_defs, tasks and
-- notes are already RLS-enabled; added columns inherit the existing policy/trigger.

-- 1. Add the token column and relax the FK to the custom-object definition.
ALTER TABLE "custom_field_defs" ADD COLUMN "object_type" TEXT;
ALTER TABLE "custom_field_defs" ALTER COLUMN "object_definition_id" DROP NOT NULL;

-- 2. Backfill the token for existing custom-object fields (token = object slug).
UPDATE "custom_field_defs" cfd
SET "object_type" = od."slug"
FROM "object_definitions" od
WHERE od."id" = cfd."object_definition_id";

-- 3. Token is now mandatory for every field def.
ALTER TABLE "custom_field_defs" ALTER COLUMN "object_type" SET NOT NULL;

-- 4. Move uniqueness/ordering off the (now nullable) definition id and onto the token.
DROP INDEX "custom_field_defs_object_definition_id_key_key";
DROP INDEX "custom_field_defs_workspace_id_object_definition_id_positio_idx";
CREATE UNIQUE INDEX "custom_field_defs_workspace_id_object_type_key_key" ON "custom_field_defs"("workspace_id", "object_type", "key");
CREATE INDEX "custom_field_defs_workspace_id_object_type_position_idx" ON "custom_field_defs"("workspace_id", "object_type", "position");

-- 5. Custom-field storage on tasks and notes (contacts/companies/deals already have it).
ALTER TABLE "tasks" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notes" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
