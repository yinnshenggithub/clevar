import "server-only";
import { withTenant } from "./tenant";

type Passage = { title: string; content: string; score: number };

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
 * Lexical reranker (no embeddings). PostgreSQL `ts_rank_cd` already accounts for
 * term proximity/cover density; on top of it we add exact-term overlap (the
 * IDF-ish "did the meaningful query words actually appear" signal), occurrence
 * density, a whole-phrase hit, and a title hit. Combined score reorders an
 * over-fetched candidate pool down to the top-k the model actually sees — the
 * over-fetch → rerank → trim funnel from the retrieval research.
 */
function rerank(cands: Passage[], query: string, limit: number): Passage[] {
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

/**
 * Retrieves the most relevant knowledge-base passages for an agent using
 * PostgreSQL full-text search (no embeddings key required), then reranks the
 * over-fetched pool with a lexical scorer and orders for "lost in the middle".
 * Returns a numbered string to inject into the agent's <knowledge> block, or
 * "" if nothing matches.
 */
export async function retrieveContext(
  workspaceId: string,
  agentId: string,
  query: string,
  limit = 6,
): Promise<string> {
  const q = (query || "").trim();
  // Over-fetch a wide candidate pool, then rerank/trim down to `limit`.
  const pool = Math.min(Math.max(limit * 4, 24), 60);
  try {
    // ── Chunk retrieval: rank ingestion-time passages (cover-density), rerank, trim. ──
    let chunks: Passage[] = [];
    if (q) {
      chunks = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT d.title AS title, c.content AS content,
            ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', ${q})) AS score
          FROM agent_chunks c
          JOIN agent_documents d ON d.id = c.document_id
          WHERE c.agent_id = ${agentId}::uuid
            AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${q})
          ORDER BY score DESC
          LIMIT ${pool}
        `,
      )) as Passage[];
    }
    if (chunks.length) {
      const top = lostInMiddle(rerank(chunks, q, limit));
      return formatPassages(top);
    }

    // Fallback: no keyword match (or vague message) — earliest chunks of recent docs,
    // so a small knowledge base is always available.
    const recent = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT d.title AS title, c.content AS content, 0 AS score
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
