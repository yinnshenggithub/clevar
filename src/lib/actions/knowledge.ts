"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { fetchUrlText } from "@/lib/url-extract";
import { chunkText } from "@/lib/chunk";
import { enrichDocumentChunks } from "@/lib/knowledge-ingest";
import type { Prisma, WorkspaceRole } from "@prisma/client";

/** Splits a document's content into passages and stores them for RAG retrieval. */
async function indexChunks(
  tx: Prisma.TransactionClient,
  args: { workspaceId: string; agentId: string; documentId: string; content: string },
): Promise<void> {
  const chunks = chunkText(args.content);
  if (!chunks.length) return;
  await tx.agentChunk.createMany({
    data: chunks.map((content, idx) => ({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      documentId: args.documentId,
      idx,
      content,
    })),
  });
}

export interface DocState {
  error?: string;
  ok?: boolean;
}

// Ingestion fans out to external APIs (contextualization + embeddings), so it
// is manage-gated and capped per workspace.
const MAX_DOCS_PER_WORKSPACE = 100;

async function ingestGate(tx: Prisma.TransactionClient, role: WorkspaceRole): Promise<string | null> {
  if (!canManageWorkspace(role)) return "Only owners and admins can manage the knowledge base.";
  const count = await tx.agentDocument.count();
  if (count >= MAX_DOCS_PER_WORKSPACE) return `Knowledge base is full (${MAX_DOCS_PER_WORKSPACE} documents max). Delete unused documents first.`;
  return null;
}

/** Imports a public web page into the agent's knowledge base. */
export async function addUrlDocument(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return { error: "Enter a valid http(s) URL." };

  let title: string;
  let text: string;
  try {
    ({ title, text } = await fetchUrlText(url));
  } catch {
    return { error: "Could not fetch that URL. Make sure it's a public page." };
  }
  if (!text || text.length < 20) return { error: "Couldn't extract readable text from that page." };

  try {
    const docId = await withTenant(ctx.workspaceId, async (tx) => {
      const gateError = await ingestGate(tx, ctx.role);
      if (gateError) throw new Error(`GATE:${gateError}`);
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw new Error("AGENT_NOT_FOUND");
      const doc = await tx.agentDocument.create({ data: { workspaceId: ctx.workspaceId, agentId, title, content: text } });
      await indexChunks(tx, { workspaceId: ctx.workspaceId, agentId, documentId: doc.id, content: text });
      return doc.id;
    });
    // Lexical search works immediately; semantic enrichment lands post-response.
    after(() => enrichDocumentChunks(ctx.workspaceId, docId));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("GATE:")) return { error: e.message.slice(5) };
    console.error("addUrlDocument failed", e);
    return { error: "Could not save the page." };
  }
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

const docSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Add some content").max(100_000),
});

export async function addDocument(agentId: string, _prev: DocState, formData: FormData): Promise<DocState> {
  const ctx = await requireAuth();

  let content = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");
  if ((!content || content.length === 0) && file instanceof File && file.size > 0) {
    if (file.size > 1024 * 1024) return { error: "File too large (max 1 MB of text)." };
    content = (await file.text()).trim();
  }
  const title = String(formData.get("title") ?? "").trim();

  const parsed = docSchema.safeParse({ title, content });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const docId = await withTenant(ctx.workspaceId, async (tx) => {
      const gateError = await ingestGate(tx, ctx.role);
      if (gateError) throw new Error(`GATE:${gateError}`);
      const agent = await tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw new Error("AGENT_NOT_FOUND");
      const doc = await tx.agentDocument.create({
        data: { workspaceId: ctx.workspaceId, agentId, title: parsed.data.title, content: parsed.data.content },
      });
      await indexChunks(tx, { workspaceId: ctx.workspaceId, agentId, documentId: doc.id, content: parsed.data.content });
      return doc.id;
    });
    // Lexical search works immediately; semantic enrichment lands post-response.
    after(() => enrichDocumentChunks(ctx.workspaceId, docId));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("GATE:")) return { error: e.message.slice(5) };
    console.error("addDocument failed", e);
    return { error: "Could not save the document." };
  }
  revalidatePath(`/app/agents/${agentId}`);
  return { ok: true };
}

export async function deleteDocument(agentId: string, documentId: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.agentDocument.deleteMany({ where: { id: documentId, agentId } }));
  revalidatePath(`/app/agents/${agentId}`);
}
