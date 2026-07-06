import "server-only";
import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { voyageConfigured, embedTexts, rerankPassages } from "./voyage";

type Passage = {
  title: string;
  content: string;
  score: number;
  id?: string;
  sourceId?: string;
  idx?: number;
  /** Page URL / filename the chunk came from (user-visible citation target). */
  source?: string | null;
};

// Below this reranker relevance the best candidate is considered off-topic and
// retrieval abstains ("" → the agent honestly says it doesn't know instead of
// grounding on an irrelevant passage). Conservative on purpose.
const MIN_RELEVANCE = 0.25;

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
  const anchors = passages.filter((p) => p.sourceId !== undefined && p.idx !== undefined);
  if (!anchors.length) return passages;
  const wanted = new Map<string, [string, number]>();
  const have = new Set(anchors.map((p) => `${p.sourceId}:${p.idx}`));
  for (const p of anchors) {
    for (const n of [p.idx! - 1, p.idx! + 1]) {
      const key = `${p.sourceId}:${n}`;
      if (n >= 0 && !have.has(key) && !wanted.has(key)) wanted.set(key, [p.sourceId!, n]);
    }
  }
  if (!wanted.size) return passages;

  try {
    const pairs = Array.from(wanted.values());
    const rows = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT source_id AS "sourceId", idx, content FROM knowledge_chunks
        WHERE (source_id, idx) IN (${Prisma.join(pairs.map(([d, i]) => Prisma.sql`(${d}::uuid, ${i})`))})
      `,
    )) as { sourceId: string; idx: number; content: string }[];
    const byKey = new Map(rows.map((r) => [`${r.sourceId}:${r.idx}`, r.content]));

    return passages.map((p) => {
      if (p.sourceId === undefined || p.idx === undefined) return p;
      const prev = byKey.get(`${p.sourceId}:${p.idx - 1}`);
      const next = byKey.get(`${p.sourceId}:${p.idx + 1}`);
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
 *   3. abstain — best relevance below threshold → [] (agent says "don't know"
 *      instead of grounding on an off-topic passage)
 *   4. neighbor expansion + lost-in-middle ordering
 *
 * Returns the final ordered passage list ([] when nothing relevant exists).
 */
export async function retrievePassages(
  workspaceId: string,
  agentId: string,
  query: string,
  limit = 6,
): Promise<{ title: string; content: string; source?: string | null }[]> {
  const q = (query || "").trim();
  try {
    if (q) {
      // ── Lexical candidates (contextual BM25 — matches the migration-33 index). ──
      const fts = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT c.id, c.source_id AS "sourceId", c.idx, s.title AS title, c.content AS content, c.source_ref AS source,
            ts_rank_cd(to_tsvector('english', coalesce(c.context_prefix, '') || ' ' || c.content),
                       websearch_to_tsquery('english', ${q})) AS score
          FROM knowledge_chunks c
          JOIN knowledge_sources s ON s.id = c.source_id
          JOIN agent_knowledge_sources aks ON aks.source_id = c.source_id AND aks.agent_id = ${agentId}::uuid
          WHERE s.status = 'ready'
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
              SELECT c.id, c.source_id AS "sourceId", c.idx, s.title AS title, c.content AS content, c.source_ref AS source,
                1 - (c.embedding <=> ${lit}::vector) AS score
              FROM knowledge_chunks c
              JOIN knowledge_sources s ON s.id = c.source_id
              JOIN agent_knowledge_sources aks ON aks.source_id = c.source_id AND aks.agent_id = ${agentId}::uuid
              WHERE s.status = 'ready' AND c.embedding IS NOT NULL
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
              return [];
            }
            // Gate tripped but lexical evidence exists → trust the lexical path.
          } catch (e) {
            console.error("rerank failed", e);
          }
        }
        if (!top?.length) top = lexicalRerank(fused, q, limit);
        const expanded = await expandNeighbors(workspaceId, top);
        return lostInMiddle(expanded).map((p) => ({ title: p.title, content: p.content, source: p.source }));
      }
    }

    // Fallback: no keyword/semantic match (or vague message) — earliest chunks of
    // recent sources, so a small knowledge base is always available.
    const recent = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT c.id, c.source_id AS "sourceId", c.idx, s.title AS title, c.content AS content, c.source_ref AS source, 0 AS score
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        JOIN agent_knowledge_sources aks ON aks.source_id = c.source_id AND aks.agent_id = ${agentId}::uuid
        WHERE s.status = 'ready'
        ORDER BY s.created_at DESC, c.idx ASC
        LIMIT ${limit}
      `,
    )) as Passage[];
    return recent.map((p) => ({ title: p.title, content: p.content, source: p.source }));
  } catch (e) {
    console.error("retrievePassages failed", e);
    return [];
  }
}

/** Numbered-string form of retrievePassages (legacy studio-chat prompt path). */
export async function retrieveContext(
  workspaceId: string,
  agentId: string,
  query: string,
  limit = 6,
): Promise<string> {
  const passages = await retrievePassages(workspaceId, agentId, query, limit);
  return passages.length ? formatPassages(passages.map((p) => ({ ...p, score: 0 }))) : "";
}

/** Builds the final system prompt, appending knowledge-base context when present. */
export function buildSystemPrompt(base: string, context: string): string {
  if (!context) return base;
  return `${base}\n\nAnswer factual questions ONLY from the knowledge base below. Sources are numbered — cite the source number(s) you used inline like [1]. If the answer isn't in these sources, say you don't have that information — never guess, never use outside knowledge, never cite a source you didn't use.\n\n${context}`;
}
