"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import {
  ingestInlineSource,
  runUrlIngest,
  enrichSourceChunks,
  claimForRecrawl,
} from "@/lib/knowledge-ingest";
import { extractFileText, supportedKnowledgeFile, MAX_FILE_BYTES } from "@/lib/file-extract";

export interface DocState {
  error?: string;
  ok?: boolean;
}

// Ingestion fans out to external APIs (contextualization + embeddings), so it
// is manage-gated and capped per workspace.
const MAX_SOURCES_PER_WORKSPACE = 100;

async function ingestGate(tx: Prisma.TransactionClient, role: WorkspaceRole): Promise<string | null> {
  if (!canManageWorkspace(role)) return "Only owners and admins can manage the knowledge base.";
  const count = await tx.knowledgeSource.count();
  if (count >= MAX_SOURCES_PER_WORKSPACE)
    return `Knowledge base is full (${MAX_SOURCES_PER_WORKSPACE} sources max). Delete unused sources first.`;
  return null;
}

/** Creates the source row (gated) and attaches it to the agent, all in one tx. */
async function createSource(
  workspaceId: string,
  role: WorkspaceRole,
  agentId: string,
  data: { type: string; title: string; config?: Prisma.InputJsonValue; status?: string; recrawlEvery?: number | null },
): Promise<{ id?: string; error?: string }> {
  try {
    const id = await withTenant(workspaceId, async (tx) => {
      const gateError = await ingestGate(tx, role);
      if (gateError) throw new Error(`GATE:${gateError}`);
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw new Error("GATE:Agent not found.");
      const source = await tx.knowledgeSource.create({
        data: {
          workspaceId,
          type: data.type,
          title: data.title,
          config: data.config ?? {},
          status: data.status ?? "pending",
          recrawlEvery: data.recrawlEvery ?? null,
        },
      });
      await tx.agentKnowledgeSource.create({ data: { workspaceId, agentId, sourceId: source.id } });
      return source.id;
    });
    return { id };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("GATE:")) return { error: e.message.slice(5) };
    console.error("createSource failed", e);
    return { error: "Could not save the source." };
  }
}

const textSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Add some content").max(400_000),
});

/** Pasted-text source — chunks inline, enriches post-response. */
export async function addTextSource(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();
  const parsed = textSchema.safeParse({
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const created = await createSource(ctx.workspaceId, ctx.role, agentId, {
    type: "text",
    title: parsed.data.title,
    config: { text: parsed.data.content.slice(0, 100_000) },
    status: "processing",
  });
  if (created.error || !created.id) return { error: created.error };

  try {
    await ingestInlineSource(ctx.workspaceId, created.id, parsed.data.content, null);
  } catch (e) {
    console.error("addTextSource ingest failed", e);
    await markFailed(ctx.workspaceId, created.id, "Could not index the text.");
    return { error: "Could not index the text." };
  }
  after(() => enrichSourceChunks(ctx.workspaceId, created.id!));
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

/** Uploaded-file source (PDF/DOCX/TXT/MD/CSV) — parses + chunks inline. */
export async function addFileSource(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();
  // Role check before burning CPU on a 10 MB parse (full gate re-runs in createSource).
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage the knowledge base." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (!supportedKnowledgeFile(file.name)) return { error: "Supported files: PDF, DOCX, TXT, MD, CSV." };
  if (file.size > MAX_FILE_BYTES) return { error: "File too large (max 10 MB)." };

  let text: string;
  try {
    text = (await extractFileText(file)).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PDF_TOO_LONG") return { error: "PDF too long (max 300 pages)." };
    console.error("addFileSource extract failed", e);
    return { error: "Couldn't read that file — is it a valid PDF/DOCX?" };
  }
  if (text.length < 20) return { error: "Couldn't extract readable text from that file." };

  const title = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 200) || "Uploaded file";
  const created = await createSource(ctx.workspaceId, ctx.role, agentId, {
    type: "file",
    title,
    config: { filename: file.name, mime: file.type || null },
    status: "processing",
  });
  if (created.error || !created.id) return { error: created.error };

  try {
    await ingestInlineSource(ctx.workspaceId, created.id, text, file.name);
  } catch (e) {
    console.error("addFileSource ingest failed", e);
    await markFailed(ctx.workspaceId, created.id, "Could not index the file.");
    return { error: "Could not index the file." };
  }
  after(() => enrichSourceChunks(ctx.workspaceId, created.id!));
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

const urlSchema = z.object({
  url: z.string().url().max(2000),
  crawl: z.boolean(),
  recrawlEvery: z.number().int().min(1).max(24 * 30).nullable(),
});

/** Web-page / site source — crawls asynchronously with checkpointed progress. */
export async function addUrlSource(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();
  const raw = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(raw)) return { error: "Enter a valid http(s) URL." };
  const crawl = formData.get("crawl") === "on";
  const recrawlRaw = String(formData.get("recrawl") ?? "");
  const recrawlEvery = recrawlRaw === "daily" ? 24 : recrawlRaw === "weekly" ? 168 : null;

  const parsed = urlSchema.safeParse({ url: raw, crawl, recrawlEvery });
  if (!parsed.success) return { error: "Enter a valid http(s) URL." };

  let host: string;
  try {
    host = new URL(parsed.data.url).hostname;
  } catch {
    return { error: "Enter a valid http(s) URL." };
  }

  const created = await createSource(ctx.workspaceId, ctx.role, agentId, {
    type: crawl ? "site" : "url",
    title: host,
    config: { url: parsed.data.url, crawl, autoTitle: true },
    status: "pending",
    recrawlEvery: parsed.data.recrawlEvery,
  });
  if (created.error || !created.id) return { error: created.error };

  after(() => runUrlIngest(ctx.workspaceId, created.id!));
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

/** Attaches an existing workspace source to an agent. */
export async function attachSource(agentId: string, sourceId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const [agent, source] = await Promise.all([
        tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } }),
        tx.knowledgeSource.findFirst({ where: { id: sourceId } }),
      ]);
      if (!agent || !source) return;
      await tx.agentKnowledgeSource.createMany({
        data: [{ workspaceId: ctx.workspaceId, agentId, sourceId }],
        skipDuplicates: true,
      });
    });
  } catch (e) {
    console.error("attachSource failed", e);
  }
  revalidatePath(`/app/agents/${agentId}`);
}

/** Detaches a source from an agent (the source itself stays for other agents). */
export async function detachSource(agentId: string, sourceId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.agentKnowledgeSource.deleteMany({ where: { agentId, sourceId } }),
  );
  revalidatePath(`/app/agents/${agentId}`);
}

/** Deletes a source everywhere (chunks + attachments cascade). */
export async function deleteSource(agentId: string, sourceId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.knowledgeSource.deleteMany({ where: { id: sourceId } }));
  revalidatePath(`/app/agents/${agentId}`);
}

/** Manual re-sync for url/site sources (re-crawl + diff by page hash). */
export async function resyncSource(agentId: string, sourceId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  // Atomic claim — a double-click or a concurrent cron run loses the race.
  if (!(await claimForRecrawl(ctx.workspaceId, sourceId))) return;
  after(() => runUrlIngest(ctx.workspaceId, sourceId));
  revalidatePath(`/app/agents/${agentId}`);
}

async function markFailed(workspaceId: string, sourceId: string, error: string): Promise<void> {
  await withTenant(workspaceId, (tx) =>
    tx.knowledgeSource.updateMany({ where: { id: sourceId }, data: { status: "failed", error } }),
  ).catch(() => {});
}
