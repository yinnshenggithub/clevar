import "server-only";
import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { voyageConfigured, embedTexts, rerankPassages } from "./voyage";

type Passage = {
  title: string;
  content: string;
  score: number;
  id?: string;
  documentId?: string;
  idx?: number;
};

// Below this reranker relevance the best candidate is considered off-topic and
// retrieval abstains ("" → the agent honestly says it doesn't know instead of
// grounding on an irrelevant passage). Conservative on purpose.
const MIN_RELEVANCE = 0.25;

/**
 * Extracts the most relevant ~`max`-char window of a document for a query, centered
 * on the first matching keyword (so long documents surface the passage that matches,
 * not just their opening). Falls back to the head when nothing matches.
 */
function bestSnippet(content: string, query: string, max = 2200): string {
  if (content.length <= max) return content;
  const terms = (query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const lc = content.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lc.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return content.slice(0, max) + "…";
  const start = Math.max(0, pos - Math.floor(max / 3));
  const end = Math.min(content.length, start + max);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

/**
 * Lexical reranker (fallback when no reranking key is configured). PostgreSQL
 * `ts_rank_cd` already accounts for term proximity/cover density; on top of it
 * we add exact-term overlap, occurrence density, a whole-phrase hit, and a
 * title hit. Reorders an over-fetched candidate pool down to the top-k.
 */
function lexicalRerank(cands: Passage[], query: string, limit: number): Passage[] {
  const terms = Array.from(
    new Set(
      (query || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    ),
  );
  if (!terms.length) return cands.slice(0, limit);
  const phrase = (query || "").toLowerCase().trim();
  const maxSql = Math.max(...cands.map((c) => c.score), 1e-9);

  const scored = cands.map((c) => {
    const lc = c.content.toLowerCase();
    const tl = (c.title || "").toLowerCase();
    let present = 0;
    let occ = 0;
    for (const t of terms) {
      const hits = lc.split(t).length - 1;
      if (hits > 0) {
        present++;
        occ += hits;
      }
    }
    const overlap = present / terms.length; // fraction of distinct query terms found
    const density = Math.min(occ / (terms.length * 3), 1); // saturating term frequency
    const phraseHit = phrase.length > 4 && lc.includes(phrase) ? 1 : 0;
    const titleHit = terms.filter((t) => tl.includes(t)).length / terms.length;
    const lex = 0.5 * overlap + 0.2 * density + 0.2 * phraseHit + 0.1 * titleHit;
    const normSql = c.score / maxSql;
    return { c, final: 0.6 * normSql + 0.4 * lex };
  });

  return scored
    .sort((a, b) => b.final - a.final)
    .slice(0, limit)
    .map((s) => s.c);
}

/**
 * Reorders ranked passages so the strongest sits FIRST and the second-strongest
 * LAST, pushing weaker ones to the middle — mitigates the "lost in the middle"
 * effect where models under-weight context buried in the center.
 */
function lostInMiddle(sorted: Passage[]): Passage[] {
  const front: Passage[] = [];
  const back: Passage[] = [];
  sorted.forEach((p, i) => (i % 2 === 0 ? front.push(p) : back.unshift(p)));
  return [...front, ...back];
}

/** Numbers passages so the prompt can require citation by source number. */
function formatPassages(passages: Passage[]): string {
  return passages
    .map((p, i) => `[${i + 1}] ${p.title}\n${p.content}`)
    .join("\n\n---\n\n");
}

/** Reciprocal Rank Fusion of the lexical and vector candidate lists (k=60). */
function rrfFuse(lists: Passage[][], pool: number): Passage[] {
  const K = 60;
  const byId = new Map<string, { p: Passage; score: number }>();
  for (const list of lists) {
    list.forEach((p, rank) => {
      const key = p.id ?? `${p.title}|${p.content.slice(0, 64)}`;
      const entry = byId.get(key) ?? { p, score: 0 };
      entry.score += 1 / (K + rank + 1);
      byId.set(key, entry);
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, pool)
    .map((e) => ({ ...e.p, score: e.score }));
}

/** Joins two chunks, trimming the ingestion-time overlap when it lines up. */
function mergeOverlap(a: string, b: string): string {
  const max = Math.min(200, a.length, b.length);
  for (let k = max; k >= 30; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return a + " … " + b;
}

/**
 * Small-to-big expansion: retrieval matched a small precise chunk; the model
 * answers from the chunk plus its immediate neighbors in the same document —
 * recovers answers that straddle chunk boundaries (procedures, policies).
 */
async function expandNeighbors(workspaceId: string, passages: Passage[]): Promise<Passage[]> {
  const anchors = passages.filter((p) => p.documentId !== undefined && p.idx !== undefined);
  if (!anchors.length) return passages;
  const wanted = new Map<string, [string, number]>();
  const have = new Set(anchors.map((p) => `${p.documentId}:${p.idx}`));
  for (const p of anchors) {
    for (const n of [p.idx! - 1, p.idx! + 1]) {
      const key = `${p.documentId}:${n}`;
      if (n >= 0 && !have.has(key) && !wanted.has(key)) wanted.set(key, [p.documentId!, n]);
    }
  }
  if (!wanted.size) return passages;

  try {
    const pairs = Array.from(wanted.values());
    const rows = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT document_id AS "documentId", idx, content FROM agent_chunks
        WHERE (document_id, idx) IN (${Prisma.join(pairs.map(([d, i]) => Prisma.sql`(${d}::uuid, ${i})`))})
      `,
    )) as { documentId: string; idx: number; content: string }[];
    const byKey = new Map(rows.map((r) => [`${r.documentId}:${r.idx}`, r.content]));

    return passages.map((p) => {
      if (p.documentId === undefined || p.idx === undefined) return p;
      const prev = byKey.get(`${p.documentId}:${p.idx - 1}`);
      const next = byKey.get(`${p.documentId}:${p.idx + 1}`);
      let content = p.content;
      if (prev) content = mergeOverlap(prev, content);
      if (next) content = mergeOverlap(content, next);
      return { ...p, content: content.slice(0, 3200) };
    });
  } catch (e) {
    console.error("expandNeighbors failed", e);
    return passages;
  }
}

/**
 * Retrieves the most relevant knowledge-base passages for an agent.
 *
 * Pipeline (each stage degrades gracefully when its dependency is absent):
 *   1. hybrid candidates — contextual BM25 (FTS over context_prefix + content)
 *      fused with pgvector cosine search via Reciprocal Rank Fusion
 *   2. rerank — voyage rerank-2.5-lite (fallback: lexical scorer)
 *   3. abstain — best relevance below threshold → "" (agent says "don't know"
 *      instead of grounding on an off-topic passage)
 *   4. neighbor expansion + lost-in-middle ordering
 *
 * Returns a numbered string for the <knowledge> block, or "" when nothing
 * relevant exists.
 */
export async function retrieveContext(
  workspaceId: string,
  agentId: string,
  query: string,
  limit = 6,
): Promise<string> {
  const q = (query || "").trim();
  try {
    if (q) {
      // ── Lexical candidates (contextual BM25 — matches the migration-31 index). ──
      const fts = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT c.id, c.document_id AS "documentId", c.idx, d.title AS title, c.content AS content,
            ts_rank_cd(to_tsvector('english', coalesce(c.context_prefix, '') || ' ' || c.content),
                       websearch_to_tsquery('english', ${q})) AS score
          FROM agent_chunks c
          JOIN agent_documents d ON d.id = c.document_id
          WHERE c.agent_id = ${agentId}::uuid
            AND to_tsvector('english', coalesce(c.context_prefix, '') || ' ' || c.content)
                @@ websearch_to_tsquery('english', ${q})
          ORDER BY score DESC
          LIMIT 20
        `,
      )) as Passage[];

      // ── Vector candidates (skipped without VOYAGE_API_KEY or embeddings). ──
      let vec: Passage[] = [];
      if (voyageConfigured()) {
        try {
          const [qv] = await embedTexts([q], "query");
          const lit = JSON.stringify(qv);
          vec = (await withTenant(workspaceId, async (tx) => {
            // The HNSW index is global across tenants while RLS + agent filters
            // apply post-ANN; widen the candidate beam so small tenants aren't
            // starved out of the top candidates.
            await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`;
            return tx.$queryRaw`
              SELECT c.id, c.document_id AS "documentId", c.idx, d.title AS title, c.content AS content,
                1 - (c.embedding <=> ${lit}::vector) AS score
              FROM agent_chunks c
              JOIN agent_documents d ON d.id = c.document_id
              WHERE c.agent_id = ${agentId}::uuid AND c.embedding IS NOT NULL
              ORDER BY c.embedding <=> ${lit}::vector
              LIMIT 20
            `;
          })) as Passage[];
        } catch (e) {
          console.error("vector search failed", e);
        }
      }

      const fused = vec.length ? rrfFuse([fts, vec], 24) : fts.slice(0, 24);
      if (fused.length) {
        let top: Passage[] | null = null;
        if (voyageConfigured()) {
          try {
            const ranked = await rerankPassages(
              q,
              fused.map((c) => `${c.title}\n${c.content}`),
              limit,
            );
            if (ranked.length && ranked[0].score >= MIN_RELEVANCE) {
              top = ranked.map((r) => fused[r.index]);
            } else if (!fts.length) {
              // Semantically weak AND zero lexical corroboration — abstain so
              // the agent says "don't know" instead of grounding off-topic.
              return "";
            }
            // Gate tripped but lexical evidence exists → trust the lexical path.
          } catch (e) {
            console.error("rerank failed", e);
          }
        }
        if (!top?.length) top = lexicalRerank(fused, q, limit);
        const expanded = await expandNeighbors(workspaceId, top);
        return formatPassages(lostInMiddle(expanded));
      }
    }

    // Fallback: no keyword/semantic match (or vague message) — earliest chunks of
    // recent docs, so a small knowledge base is always available.
    const recent = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT c.id, c.document_id AS "documentId", c.idx, d.title AS title, c.content AS content, 0 AS score
        FROM agent_chunks c
        JOIN agent_documents d ON d.id = c.document_id
        WHERE c.agent_id = ${agentId}::uuid
        ORDER BY d.created_at DESC, c.idx ASC
        LIMIT ${limit}
      `,
    )) as Passage[];
    if (recent.length) return formatPassages(recent);

    // ── Legacy fallback: documents that predate chunking (no chunk rows). ──
    let docs: { title: string; content: string }[] = [];
    if (q) {
      docs = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT title, content FROM agent_documents
          WHERE agent_id = ${agentId}::uuid
            AND to_tsvector('english', title || ' ' || content) @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank_cd(to_tsvector('english', title || ' ' || content), websearch_to_tsquery('english', ${q})) DESC
          LIMIT 3
        `,
      )) as { title: string; content: string }[];
    }
    if (!docs.length) {
      docs = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`SELECT title, content FROM agent_documents WHERE agent_id = ${agentId}::uuid ORDER BY created_at DESC LIMIT 3`,
      )) as { title: string; content: string }[];
    }
    if (!docs.length) return "";
    return formatPassages(docs.map((d) => ({ title: d.title, content: bestSnippet(d.content, q), score: 0 })));
  } catch (e) {
    console.error("retrieveContext failed", e);
    return "";
  }
}

/** Builds the final system prompt, appending knowledge-base context when present. */
export function buildSystemPrompt(base: string, context: string): string {
  if (!context) return base;
  return `${base}\n\nAnswer factual questions ONLY from the knowledge base below. Sources are numbered — cite the source number(s) you used inline like [1]. If the answer isn't in these sources, say you don't have that information — never guess, never use outside knowledge, never cite a source you didn't use.\n\n${context}`;
}
