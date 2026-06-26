-- CreateTable
CREATE TABLE "object_definitions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name_singular" TEXT NOT NULL,
    "name_plural" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Boxes',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "object_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_defs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "object_definition_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_records" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "object_definition_id" UUID NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "custom_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "object_definitions_workspace_id_slug_key" ON "object_definitions"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "custom_field_defs_workspace_id_object_definition_id_positio_idx" ON "custom_field_defs"("workspace_id", "object_definition_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_defs_object_definition_id_key_key" ON "custom_field_defs"("object_definition_id", "key");

-- CreateIndex
CREATE INDEX "custom_records_workspace_id_object_definition_id_created_at_idx" ON "custom_records"("workspace_id", "object_definition_id", "created_at");

-- AddForeignKey
ALTER TABLE "object_definitions" ADD CONSTRAINT "object_definitions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_object_definition_id_fkey" FOREIGN KEY ("object_definition_id") REFERENCES "object_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_object_definition_id_fkey" FOREIGN KEY ("object_definition_id") REFERENCES "object_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for custom-object tenant tables.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['object_definitions', 'custom_field_defs', 'custom_records'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())', t);
    EXECUTE format('CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()', t);
  END LOOP;
END $$;
