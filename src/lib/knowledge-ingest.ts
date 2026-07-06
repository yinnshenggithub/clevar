import "server-only";
import { prisma } from "./prisma";
import { withTenant } from "./tenant";
import { voyageConfigured, embedTexts } from "./voyage";
import { contextualizeChunks, contextualizeConfigured } from "./contextualize";

// Post-ingest enrichment: Contextual-Retrieval prefixes + voyage embeddings.
// Runs in after() right after a document is added, and via the cron sweep for
// anything that slipped (deploy timeouts, missing keys at ingest time, backfill
// of pre-vector rows). Idempotent — only touches chunks with NULL embedding.

type PendingChunk = { id: string; idx: number; content: string; contextPrefix: string | null };

/** Contextualizes + embeds a document's not-yet-embedded chunks. Best-effort; never throws. */
export async function enrichDocumentChunks(workspaceId: string, documentId: string): Promise<void> {
  try {
    const doc = await withTenant(workspaceId, (tx) =>
      tx.agentDocument.findFirst({ where: { id: documentId }, select: { content: true } }),
    );
    if (!doc) return;

    const rows = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT id, idx, content, context_prefix AS "contextPrefix"
        FROM agent_chunks
        WHERE document_id = ${documentId}::uuid AND embedding IS NULL
        ORDER BY idx ASC
      `,
    )) as PendingChunk[];
    if (!rows.length) return;

    let prefixes: (string | null)[] = rows.map((r) => r.contextPrefix);
    if (contextualizeConfigured() && prefixes.some((p) => !p)) {
      const generated = await contextualizeChunks(
        doc.content,
        rows.map((r) => r.content),
      );
      prefixes = rows.map((r, i) => r.contextPrefix ?? generated[i]);
    }

    if (!voyageConfigured()) {
      // No embedding key yet — persist prefixes so contextual BM25 still benefits;
      // embeddings land later via the cron sweep once the key exists.
      await persist(workspaceId, rows, prefixes, null);
      return;
    }

    const inputs = rows.map((r, i) => (prefixes[i] ? `${prefixes[i]}\n\n${r.content}` : r.content));
    const vectors = await embedTexts(inputs, "document");
    await persist(workspaceId, rows, prefixes, vectors);
  } catch (e) {
    console.error("enrichDocumentChunks failed", e);
  }
}

/** Writes prefixes/vectors in small transactions (RLS-scoped; stays well under the tx timeout). */
async function persist(
  workspaceId: string,
  rows: PendingChunk[],
  prefixes: (string | null)[],
  vectors: number[][] | null,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 40) {
    const upper = Math.min(i + 40, rows.length);
    await withTenant(workspaceId, async (tx) => {
      for (let k = i; k < upper; k++) {
        if (vectors) {
          // pgvector accepts the '[0.1,0.2,…]' literal — exactly JSON.stringify's output.
          await tx.$executeRaw`
            UPDATE agent_chunks SET context_prefix = ${prefixes[k]}, embedding = ${JSON.stringify(vectors[k])}::vector
            WHERE id = ${rows[k].id}::uuid`;
        } else if (prefixes[k]) {
          await tx.$executeRaw`
            UPDATE agent_chunks SET context_prefix = ${prefixes[k]} WHERE id = ${rows[k].id}::uuid`;
        }
      }
    });
  }
}

/**
 * Cron sweep: embeds any chunks still missing vectors across workspaces
 * (backfill of pre-vector rows + retries of failed after() runs). Capped per
 * tick; the daily cron drains large backlogs over successive days.
 */
export async function embedPendingKnowledge(): Promise<{ enrichedDocs: number }> {
  if (!voyageConfigured()) return { enrichedDocs: 0 };
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 200 });
  let enriched = 0;
  for (const w of workspaces) {
    if (enriched >= 20) break;
    try {
      const docs = (await withTenant(w.id, (tx) =>
        tx.$queryRaw`SELECT DISTINCT document_id AS id FROM agent_chunks WHERE embedding IS NULL LIMIT 5`,
      )) as { id: string }[];
      for (const d of docs) {
        await enrichDocumentChunks(w.id, d.id);
        enriched++;
        if (enriched >= 20) break;
      }
    } catch (e) {
      console.error("embedPendingKnowledge workspace failed", w.id, e);
    }
  }
  return { enrichedDocs: enriched };
}
