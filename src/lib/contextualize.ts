import "server-only";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// Contextual Retrieval: situate each chunk within its document so both the
// embedding and the FTS index carry the surrounding topic ("From Acme's
// billing FAQ, covering refund timelines"). Published results: contextual
// embeddings + contextual BM25 + reranking ≈ 67% fewer retrieval failures.
// Utility calls are always Haiku regardless of the agent's reply model.

const CONTEXT_MODEL = "claude-haiku-4-5-20251001";
const MAX_DOC_CHARS = 60_000;
const CONCURRENCY = 8;

export function contextualizeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Document view sent per call — whole doc when small (prompt-cached across chunks), head+tail otherwise. */
function docView(content: string): string {
  if (content.length <= MAX_DOC_CHARS) return content;
  return `${content.slice(0, 40_000)}\n[…]\n${content.slice(-15_000)}`;
}

async function situate(doc: string, chunk: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: anthropic(CONTEXT_MODEL),
      temperature: 0,
      maxTokens: 150,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<document>\n${doc}\n</document>`,
              // Cache the (identical) document block across the per-chunk calls.
              providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
            },
            {
              type: "text",
              text: `Here is the chunk we want to situate within the whole document:\n<chunk>\n${chunk}\n</chunk>\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`,
            },
          ],
        },
      ],
    });
    const t = text.trim();
    return t ? t.slice(0, 600) : null;
  } catch {
    return null; // per-chunk best-effort — a missing prefix only costs recall, never breaks ingest
  }
}

/**
 * Generates a situating context per chunk. Returns null entries on failure or
 * when unconfigured — callers index the raw chunk as before.
 */
export async function contextualizeChunks(docContent: string, chunks: string[]): Promise<(string | null)[]> {
  if (!contextualizeConfigured() || chunks.length < 2) return chunks.map(() => null);
  const doc = docView(docContent);
  const out: (string | null)[] = new Array(chunks.length).fill(null);

  // First call alone to warm the prompt cache, then bounded parallelism.
  out[0] = await situate(doc, chunks[0]);
  for (let i = 1; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((c) => situate(doc, c)));
    results.forEach((r, j) => (out[i + j] = r));
  }
  return out;
}
