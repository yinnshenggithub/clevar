-- CreateTable
CREATE TABLE "agent_documents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_documents_workspace_id_agent_id_idx" ON "agent_documents"("workspace_id", "agent_id");

-- AddForeignKey
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS + full-text search index for the knowledge base.
ALTER TABLE "agent_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_documents" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "agent_documents" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
CREATE INDEX agent_documents_fts ON "agent_documents" USING gin (to_tsvector('english', title || ' ' || content));
