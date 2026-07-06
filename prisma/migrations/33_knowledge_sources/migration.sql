-- Workspace-shared knowledge sources (design §3.1/§3.2): source lifecycle
-- (pending→processing→ready→failed), chunks keyed by source, and a many-to-many
-- agent↔source attachment. Backfills the per-agent agent_documents/agent_chunks
-- data (ids and embeddings preserved); old tables stay read-only for one release.

CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT,
    "last_synced_at" TIMESTAMPTZ,
    "recrawl_every" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_sources_workspace_id_status_idx" ON "knowledge_sources"("workspace_id", "status");
CREATE INDEX "knowledge_sources_workspace_id_created_at_idx" ON "knowledge_sources"("workspace_id", "created_at");

CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "source_ref" TEXT,
    "context_prefix" TEXT,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1024),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_chunks_source_id_idx_key" UNIQUE ("source_id", "idx")
);

CREATE INDEX "knowledge_chunks_workspace_id_idx" ON "knowledge_chunks"("workspace_id");
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "knowledge_chunks_ctx_fts_idx" ON "knowledge_chunks"
  USING GIN (to_tsvector('english', coalesce("context_prefix", '') || ' ' || "content"));

CREATE TABLE "agent_knowledge_sources" (
    "agent_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    CONSTRAINT "agent_knowledge_sources_pkey" PRIMARY KEY ("agent_id", "source_id")
);

CREATE INDEX "agent_knowledge_sources_source_id_idx" ON "agent_knowledge_sources"("source_id");
CREATE INDEX "agent_knowledge_sources_workspace_id_idx" ON "agent_knowledge_sources"("workspace_id");

ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_knowledge_sources" ADD CONSTRAINT "agent_knowledge_sources_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_knowledge_sources" ADD CONSTRAINT "agent_knowledge_sources_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_knowledge_sources" ADD CONSTRAINT "agent_knowledge_sources_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill runs BEFORE RLS/triggers: the set_workspace_id trigger overwrites
-- workspace_id from the tenant GUC and raises when it's unset (migrations have
-- no tenant context).
-- ── Backfill from the per-agent tables (ids + embeddings preserved) ──────────
INSERT INTO "knowledge_sources" ("id", "workspace_id", "type", "title", "config", "status", "chunk_count", "last_synced_at", "created_at", "updated_at")
SELECT d."id", d."workspace_id", 'text', d."title", '{"legacy": true}'::jsonb, 'ready',
  (SELECT count(*)::int FROM "agent_chunks" c WHERE c."document_id" = d."id"),
  d."created_at", d."created_at", d."created_at"
FROM "agent_documents" d;

INSERT INTO "knowledge_chunks" ("id", "workspace_id", "source_id", "idx", "content", "context_prefix", "token_count", "embedding", "created_at")
SELECT c."id", c."workspace_id", c."document_id", c."idx", c."content", c."context_prefix",
  GREATEST(1, length(c."content") / 4), c."embedding", c."created_at"
FROM "agent_chunks" c;

INSERT INTO "agent_knowledge_sources" ("agent_id", "source_id", "workspace_id")
SELECT DISTINCT d."agent_id", d."id", d."workspace_id" FROM "agent_documents" d;

-- Row-Level Security (template from 8_custom_objects).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['knowledge_sources', 'knowledge_chunks', 'agent_knowledge_sources'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())', t);
    EXECUTE format('CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()', t);
  END LOOP;
END $$;
