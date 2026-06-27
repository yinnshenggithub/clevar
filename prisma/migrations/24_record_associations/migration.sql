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

-- CreateIndex
CREATE INDEX "association_types_workspace_id_to_object_idx" ON "association_types"("workspace_id", "to_object");

-- CreateIndex
CREATE UNIQUE INDEX "association_types_workspace_id_from_object_to_object_label_key" ON "association_types"("workspace_id", "from_object", "to_object", "label");

-- CreateIndex
CREATE INDEX "record_associations_workspace_id_from_type_from_id_idx" ON "record_associations"("workspace_id", "from_type", "from_id");

-- CreateIndex
CREATE INDEX "record_associations_workspace_id_to_type_to_id_idx" ON "record_associations"("workspace_id", "to_type", "to_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_associations_association_type_id_from_type_from_id_t_key" ON "record_associations"("association_type_id", "from_type", "from_id", "to_type", "to_id");

-- AddForeignKey
ALTER TABLE "association_types" ADD CONSTRAINT "association_types_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_associations" ADD CONSTRAINT "record_associations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_associations" ADD CONSTRAINT "record_associations_association_type_id_fkey" FOREIGN KEY ("association_type_id") REFERENCES "association_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK: cardinality vocabulary (mirrors the TS union)
ALTER TABLE "association_types" ADD CONSTRAINT "association_types_cardinality_check"
  CHECK ("cardinality" IN ('one_to_one', 'one_to_many', 'many_to_many'));

-- Row-Level Security for the association tenant tables (template from 8_custom_objects).
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
