import "server-only";
import { createHash } from "crypto";
import { prisma } from "./prisma";
import { withTenant } from "./tenant";
import { chunkText } from "./chunk";
import { voyageConfigured, embedTexts } from "./voyage";
import { contextualizeChunks, contextualizeConfigured } from "./contextualize";
import { fetchUrlPage, fetchRobotsDisallow, fetchSitemapUrls } from "./url-extract";

// Knowledge-source ingestion (design §3.2): text/file sources chunk inline in
// the action; url/site sources crawl asynchronously with a checkpoint in
// `config` so the daily cron can resume runs that outlive the function window.
// Enrichment (Contextual-Retrieval prefixes + voyage embeddings) is idempotent
// on NULL embedding and always best-effort.

const PAGE_CAP = 50;
const DEPTH_CAP = 2;
const CRAWL_DELAY_MS = 300;
/** Page-namespaced chunk idx: pageNo * 1000 + chunkNo (chunkText caps at 300/page). */
const PAGE_STRIDE = 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CrawlConfig {
  url: string;
  crawl: boolean; // false = single page
  autoTitle?: boolean;
  robots?: string[];
  queue?: { u: string; d: number }[];
  visited?: string[];
  pages?: Record<string, number>; // url → stable page number
  hashes?: Record<string, string>; // url → content hash
  nextPage?: number;
  errors?: number;
  [key: string]: unknown;
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function robotsDisallowed(rules: string[], url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return rules.some((r) => r && path.startsWith(r.replace(/\*.*$/, "")));
  } catch {
    return true;
  }
}

/** Inserts a text's chunks for one source at the given page block (replacing the block). */
async function writePageChunks(
  workspaceId: string,
  sourceId: string,
  text: string,
  pageNo: number,
  sourceRef: string | null,
): Promise<number> {
  const chunks = chunkText(text);
  const base = pageNo * PAGE_STRIDE;
  await withTenant(workspaceId, async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { sourceId, idx: { gte: base, lt: base + PAGE_STRIDE } } });
    if (chunks.length) {
      await tx.knowledgeChunk.createMany({
        data: chunks.map((content, i) => ({
          workspaceId,
          sourceId,
          idx: base + i,
          content,
          sourceRef,
          tokenCount: Math.max(1, Math.ceil(content.length / 4)),
        })),
      });
    }
  });
  return chunks.length;
}

/** Text/file ingest — runs inline in the action (fast); enrichment follows via after(). */
export async function ingestInlineSource(
  workspaceId: string,
  sourceId: string,
  text: string,
  sourceRef: string | null,
): Promise<void> {
  const count = await writePageChunks(workspaceId, sourceId, text, 0, sourceRef);
  await withTenant(workspaceId, (tx) =>
    tx.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: "ready",
        error: null,
        chunkCount: count,
        tokenCount: Math.ceil(text.length / 4),
        contentHash: sha1(text),
        lastSyncedAt: new Date(),
      },
    }),
  );
}

/**
 * URL/site ingest with checkpointing. Seeds robots + sitemap on first run,
 * then BFS over same-origin links (depth ≤ 2, ≤ 50 pages, 300 ms politeness).
 * The frontier persists in config after every page, so a run killed by the
 * function window resumes from where it stopped.
 */
export async function runUrlIngest(workspaceId: string, sourceId: string): Promise<void> {
  try {
    const source = await withTenant(workspaceId, (tx) => tx.knowledgeSource.findFirst({ where: { id: sourceId } }));
    if (!source || (source.type !== "url" && source.type !== "site")) return;

    const cfg = { ...(source.config as unknown as CrawlConfig) };
    if (!cfg.url) throw new Error("missing url");
    const origin = new URL(cfg.url).origin;

    await withTenant(workspaceId, (tx) =>
      tx.knowledgeSource.update({ where: { id: sourceId }, data: { status: "processing", error: null } }),
    );

    // First run (or reset by a re-sync): seed robots, sitemap, frontier.
    if (!cfg.queue && !cfg.visited?.length) {
      cfg.robots = await fetchRobotsDisallow(origin);
      const start = { u: cfg.url, d: 0 };
      const sitemap = cfg.crawl ? await fetchSitemapUrls(origin, PAGE_CAP) : [];
      cfg.queue = [start, ...sitemap.filter((u) => u !== cfg.url).map((u) => ({ u, d: 1 }))];
      cfg.visited = [];
      cfg.pages ??= {};
      cfg.hashes ??= {};
      cfg.nextPage ??= 0;
      cfg.errors = 0;
    }

    const queue = cfg.queue ?? [];
    const visited = new Set(cfg.visited ?? []);
    const robots = cfg.robots ?? [];
    let title: string | null = null;

    while (queue.length && visited.size < PAGE_CAP) {
      const { u, d } = queue.shift()!;
      if (visited.has(u)) continue;
      visited.add(u);
      if (robotsDisallowed(robots, u)) continue;

      try {
        const page = await fetchUrlPage(u);
        if (!title && page.title) title = page.title;
        if (page.text.length >= 40) {
          const hash = sha1(page.text);
          if (cfg.hashes![u] !== hash) {
            const pageNo = cfg.pages![u] ?? cfg.nextPage!++;
            await writePageChunks(workspaceId, sourceId, page.text, pageNo, u);
            cfg.pages![u] = pageNo;
            cfg.hashes![u] = hash;
          }
        }
        if (cfg.crawl && d < DEPTH_CAP) {
          for (const link of page.links) {
            if (!visited.has(link) && !queue.some((q) => q.u === link) && queue.length < 300) {
              queue.push({ u: link, d: d + 1 });
            }
          }
        }
      } catch (e) {
        cfg.errors = (cfg.errors ?? 0) + 1;
        console.error("crawl page failed", u, e);
      }

      // Checkpoint after every page — resumable by the cron sweep.
      cfg.queue = queue;
      cfg.visited = Array.from(visited);
      await withTenant(workspaceId, (tx) =>
        tx.knowledgeSource.update({
          where: { id: sourceId },
          data: { config: cfg as any, ...(title && cfg.autoTitle ? { title: title.slice(0, 200) } : {}) },
        }),
      );
      await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
    }

    // Full completion (not page-cap truncation): drop chunks of pages that
    // disappeared from the site since the last crawl.
    if (!queue.length && visited.size < PAGE_CAP) {
      for (const [url, pageNo] of Object.entries(cfg.pages ?? {})) {
        if (!visited.has(url)) {
          const base = pageNo * PAGE_STRIDE;
          await withTenant(workspaceId, (tx) =>
            tx.knowledgeChunk.deleteMany({ where: { sourceId, idx: { gte: base, lt: base + PAGE_STRIDE } } }),
          );
          delete cfg.pages![url];
          delete cfg.hashes![url];
        }
      }
    }

    // Finalize: counts + ready. Keep pages/hashes for the next re-crawl diff;
    // clear the frontier so a re-sync starts fresh.
    cfg.queue = undefined;
    cfg.visited = [];
    const totals = await withTenant(workspaceId, async (tx) => {
      const agg = await tx.knowledgeChunk.aggregate({
        where: { sourceId },
        _count: { _all: true },
        _sum: { tokenCount: true },
      });
      return { count: agg._count._all, tokens: agg._sum.tokenCount ?? 0 };
    });
    await withTenant(workspaceId, (tx) =>
      tx.knowledgeSource.update({
        where: { id: sourceId },
        data: {
          status: totals.count > 0 ? "ready" : "failed",
          error: totals.count > 0 ? null : "No readable pages found.",
          config: cfg as any,
          chunkCount: totals.count,
          tokenCount: totals.tokens,
          lastSyncedAt: new Date(),
        },
      }),
    );

    await enrichSourceChunks(workspaceId, sourceId);
  } catch (e) {
    console.error("runUrlIngest failed", sourceId, e);
    await withTenant(workspaceId, (tx) =>
      tx.knowledgeSource.updateMany({
        where: { id: sourceId },
        data: { status: "failed", error: "Import failed — check the URL and try re-syncing." },
      }),
    ).catch(() => {});
  }
}

// ── Enrichment: Contextual-Retrieval prefixes + embeddings ────────────────────

type PendingChunk = { id: string; idx: number; content: string; contextPrefix: string | null };

/** Per-invocation enrichment cap — a 50-page crawl can pend 2,000+ chunks; the
 *  rest drains via the cron sweep instead of blowing the function window. */
const ENRICH_CHUNKS_PER_RUN = 150;

/** Contextualizes + embeds a source's not-yet-embedded chunks. Best-effort; never throws. */
export async function enrichSourceChunks(workspaceId: string, sourceId: string): Promise<void> {
  try {
    const rows = (await withTenant(workspaceId, (tx) =>
      tx.$queryRaw`
        SELECT id, idx, content, context_prefix AS "contextPrefix"
        FROM knowledge_chunks
        WHERE source_id = ${sourceId}::uuid AND embedding IS NULL
        ORDER BY idx ASC
        LIMIT ${ENRICH_CHUNKS_PER_RUN}
      `,
    )) as PendingChunk[];
    if (!rows.length) return;

    let prefixes: (string | null)[] = rows.map((r) => r.contextPrefix);
    if (contextualizeConfigured() && prefixes.some((p) => !p)) {
      // Document view for situating: the source's own chunks in order. For
      // crawled sites this spans pages — still a useful topical frame.
      const docView = rows.map((r) => r.content).join("\n\n");
      const generated = await contextualizeChunks(
        docView,
        rows.map((r) => r.content),
      );
      prefixes = rows.map((r, i) => r.contextPrefix ?? generated[i]);
      // Persist prefixes immediately: if the embed step dies (window/API), the
      // next run skips the Haiku pass for these chunks instead of re-paying it.
      await persist(workspaceId, rows, prefixes, null);
    }

    if (!voyageConfigured()) return; // prefixes saved above; embeddings via cron once keyed
    const inputs = rows.map((r, i) => (prefixes[i] ? `${prefixes[i]}\n\n${r.content}` : r.content));
    const vectors = await embedTexts(inputs, "document");
    await persist(workspaceId, rows, prefixes, vectors);
  } catch (e) {
    console.error("enrichSourceChunks failed", e);
  }
}

/** Writes prefixes/vectors in small transactions (RLS-scoped; stays under the tx timeout). */
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
          await tx.$executeRaw`
            UPDATE knowledge_chunks SET context_prefix = ${prefixes[k]}, embedding = ${JSON.stringify(vectors[k])}::vector
            WHERE id = ${rows[k].id}::uuid`;
        } else if (prefixes[k]) {
          await tx.$executeRaw`
            UPDATE knowledge_chunks SET context_prefix = ${prefixes[k]} WHERE id = ${rows[k].id}::uuid`;
        }
      }
    });
  }
}

// ── Cron maintenance sweep ─────────────────────────────────────────────────────

/**
 * Daily knowledge upkeep: resume crawls that outlived their function window,
 * run due scheduled re-crawls, and backfill missing embeddings. Everything is
 * capped per tick; large backlogs drain across successive days.
 */
export async function knowledgeMaintenance(): Promise<{ resumed: number; recrawled: number; enrichedSources: number }> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 200 });
  let resumed = 0;
  let recrawled = 0;
  let enrichedSources = 0;

  for (const w of workspaces) {
    try {
      // 1) Stalled crawls: processing but untouched for 15+ minutes.
      if (resumed < 2) {
        const stalled = await withTenant(w.id, (tx) =>
          tx.knowledgeSource.findMany({
            where: {
              status: "processing",
              type: { in: ["url", "site"] },
              updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
            },
            select: { id: true },
            take: 2 - resumed,
          }),
        );
        for (const s of stalled) {
          await runUrlIngest(w.id, s.id);
          resumed++;
        }
      }

      // 2) Scheduled re-crawls (recrawlEvery hours elapsed since last sync).
      if (recrawled < 2) {
        const due = (await withTenant(w.id, (tx) =>
          tx.$queryRaw`
            SELECT id FROM knowledge_sources
            WHERE status = 'ready' AND type IN ('url','site') AND recrawl_every IS NOT NULL
              AND last_synced_at < now() - (recrawl_every || ' hours')::interval
            ORDER BY last_synced_at ASC
            LIMIT ${2 - recrawled}
          `,
        )) as { id: string }[];
        for (const s of due) {
          if (await claimForRecrawl(w.id, s.id)) {
            await runUrlIngest(w.id, s.id);
            recrawled++;
          }
        }
      }

      // 3) Embedding backfill (missing keys at ingest time, failed runs, legacy rows).
      if (voyageConfigured() && enrichedSources < 20) {
        const pending = (await withTenant(w.id, (tx) =>
          tx.$queryRaw`SELECT DISTINCT source_id AS id FROM knowledge_chunks WHERE embedding IS NULL LIMIT 5`,
        )) as { id: string }[];
        for (const s of pending) {
          await enrichSourceChunks(w.id, s.id);
          enrichedSources++;
          if (enrichedSources >= 20) break;
        }
      }
    } catch (e) {
      console.error("knowledgeMaintenance workspace failed", w.id, e);
    }
  }
  return { resumed, recrawled, enrichedSources };
}

/**
 * Atomically claims a source for re-crawl and clears its frontier (keeps
 * pages/hashes so the re-crawl diffs cheaply). Returns false when another run
 * already holds it — the double-click / concurrent-cron guard.
 */
export async function claimForRecrawl(workspaceId: string, sourceId: string): Promise<boolean> {
  const claimed = await withTenant(workspaceId, (tx) =>
    tx.knowledgeSource.updateMany({
      where: { id: sourceId, type: { in: ["url", "site"] }, status: { not: "processing" } },
      data: { status: "processing" },
    }),
  );
  if (claimed.count === 0) return false;
  const source = await withTenant(workspaceId, (tx) => tx.knowledgeSource.findFirst({ where: { id: sourceId } }));
  if (!source) return false;
  const cfg = { ...(source.config as unknown as CrawlConfig) };
  cfg.queue = undefined;
  cfg.visited = [];
  await withTenant(workspaceId, (tx) =>
    tx.knowledgeSource.update({ where: { id: sourceId }, data: { config: cfg as any } }),
  );
  return true;
}
