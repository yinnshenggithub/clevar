import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { retrievePassages } from "@/lib/knowledge";
import { voyageConfigured } from "@/lib/voyage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Test-bench retrieval inspector: shows WHICH knowledge passages a message
 * would ground on (same pipeline as production replies). Read-only, no LLM
 * call, no credits.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const q = typeof body.q === "string" ? body.q.slice(0, 2000) : "";

  const agent = await withTenant(ctx.workspaceId, (tx) =>
    tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true, grounding: true } }),
  );
  if (!agent) return new Response("Agent not found", { status: 404 });

  const passages = await retrievePassages(ctx.workspaceId, agentId, q);
  return Response.json({
    semantic: voyageConfigured(),
    grounding: agent.grounding,
    sufficient: passages.length > 0,
    passages: passages.map((p, i) => ({
      n: i + 1,
      title: p.title,
      source: p.source ?? null,
      snippet: p.content.slice(0, 360) + (p.content.length > 360 ? "…" : ""),
    })),
  });
}
