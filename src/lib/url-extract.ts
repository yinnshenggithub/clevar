import "server-only";

/** Rejects obviously-internal hosts to limit SSRF. Best-effort, not exhaustive. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1)/.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&quot;": '"' };

/** Fetches a public URL and returns its title + readable text (HTML stripped). */
export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("UNSUPPORTED_PROTOCOL");
  if (isBlockedHost(parsed.hostname)) throw new Error("BLOCKED_HOST");

  const res = await fetch(url, {
    headers: { "user-agent": "ClevarBot/1.0 (+knowledge-import)", accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error("FETCH_FAILED");

  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch?.[1] || parsed.hostname).trim().slice(0, 200);

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;/g, (m) => ENTITIES[m] ?? " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);

  return { title, text };
}
