import "server-only";

// Voyage AI client (embeddings + reranking) — plain fetch, no SDK dependency.
// Optional: everything degrades to lexical retrieval when VOYAGE_API_KEY is unset.

const API = "https://api.voyageai.com/v1";
export const EMBEDDING_DIM = 1024;
const EMBED_MODEL = "voyage-3.5";
const RERANK_MODEL = "rerank-2.5-lite";

export function voyageConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`voyage ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * Embeds texts with voyage-3.5. `inputType` asymmetry ("query" vs "document")
 * measurably improves retrieval. Batched at the API's 128-input limit; long
 * inputs are truncated server-side (API default).
 */
export async function embedTexts(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
  // Assign by the API's per-item index — never rely on response ordering, a
  // silently misordered response would attach vectors to the wrong chunks.
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += 128) {
    const json = await post("/embeddings", {
      input: texts.slice(i, i + 128),
      model: EMBED_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIM,
    });
    for (const d of json.data ?? []) out[i + d.index] = d.embedding;
  }
  if (out.some((v) => !Array.isArray(v))) throw new Error("voyage embeddings incomplete");
  return out;
}

/** Reranks documents against a query; returns original indices with relevance scores (desc). */
export async function rerankPassages(
  query: string,
  documents: string[],
  topK: number,
): Promise<{ index: number; score: number }[]> {
  const json = await post("/rerank", {
    query,
    documents,
    model: RERANK_MODEL,
    top_k: Math.min(topK, documents.length),
  });
  return (json.data ?? []).map((d: any) => ({ index: d.index, score: d.relevance_score }));
}
