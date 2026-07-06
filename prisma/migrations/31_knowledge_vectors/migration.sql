-- Semantic retrieval upgrade: pgvector embeddings + Contextual-Retrieval prefix
-- on knowledge chunks. Embeddings are written asynchronously after ingest;
-- NULL embedding = lexical-only until the enrichment pass lands.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "agent_chunks"
  ADD COLUMN "context_prefix" TEXT,
  ADD COLUMN "embedding" vector(1024);

-- ANN index (cosine). Rows with NULL embedding are simply not indexed.
CREATE INDEX "agent_chunks_embedding_hnsw_idx" ON "agent_chunks"
  USING hnsw ("embedding" vector_cosine_ops);

-- Contextual BM25: lexical search matches the situating context too.
-- Replaces the plain-content FTS index from migration 25.
DROP INDEX IF EXISTS "agent_chunks_content_fts_idx";
CREATE INDEX "agent_chunks_ctx_fts_idx" ON "agent_chunks"
  USING GIN (to_tsvector('english', coalesce("context_prefix", '') || ' ' || "content"));
