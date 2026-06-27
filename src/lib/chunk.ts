// Splits document text into overlapping, sentence-aware passages for RAG.
// Pure (no imports) so it can run anywhere.

export function chunkText(text: string, opts?: { size?: number; overlap?: number; maxChunks?: number }): string[] {
  const size = opts?.size ?? 900;
  const overlap = opts?.overlap ?? 120;
  const maxChunks = opts?.maxChunks ?? 300;

  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let cur = "";

  const push = (s: string) => {
    const t = s.trim();
    if (t) chunks.push(t);
  };

  for (const sentence of sentences) {
    let s = sentence;
    // Hard-split a single oversized sentence.
    while (s.length > size) {
      push(s.slice(0, size));
      s = s.slice(size - overlap);
    }
    if (cur.length + s.length > size && cur) {
      push(cur);
      cur = cur.slice(Math.max(0, cur.length - overlap)); // carry overlap into next chunk
    }
    cur += s;
    if (chunks.length >= maxChunks) break;
  }
  if (chunks.length < maxChunks) push(cur);

  return chunks.slice(0, maxChunks);
}
