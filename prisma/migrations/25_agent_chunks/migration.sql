-- CreateTable
CREATE TABLE "agent_chunks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_chunks_workspace_id_agent_id_idx" ON "agent_chunks"("workspace_id", "agent_id");

-- CreateIndex
CREATE INDEX "agent_chunks_document_id_idx" ON "agent_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "agent_chunks" ADD CONSTRAINT "agent_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_chunks" ADD CONSTRAINT "agent_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "agent_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text index for fast chunk retrieval.
CREATE INDEX "agent_chunks_content_fts_idx" ON "agent_chunks" USING GIN (to_tsvector('english', "content"));

-- Row-Level Security (template from 8_custom_objects).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['agent_chunks'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())', t);
    EXECUTE format('CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()', t);
  END LOOP;
END $$;
