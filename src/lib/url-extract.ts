import "server-only";
import dns from "node:dns/promises";

/** Rejects obviously-internal host NAMES. IP-level checks happen post-resolution. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".internal");
}

/** True when a resolved address is loopback/private/link-local/metadata-range. */
function isPrivateIp(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const h = address.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4-mapped IPv6 — check the embedded IPv4.
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1], 4);
  return false;
}

/**
 * SSRF guard for every crawler-originated fetch: protocol + hostname blocklist,
 * then DNS resolution with a private-range check on EVERY returned address —
 * this also neutralizes numeric-IP encodings (decimal/hex/octal literals
 * resolve through getaddrinfo) and bracketed IPv6 literals. Residual risk:
 * DNS-rebinding between this check and the actual connect (documented,
 * accepted — closing it needs a custom dialer).
 */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  const url = typeof raw === "string" ? new URL(raw) : raw;
  if (!/^https?:$/.test(url.protocol)) throw new Error("UNSUPPORTED_PROTOCOL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHost(host)) throw new Error("BLOCKED_HOST");
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("BLOCKED_HOST"); // unresolvable — nothing legitimate to fetch
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address, a.family))) {
    throw new Error("BLOCKED_HOST");
  }
  return url;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&quot;": '"' };

/** Fetches a public URL and returns its title + readable text (HTML stripped). */
export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const { title, text } = await fetchUrlPage(url);
  return { title, text };
}

/**
 * Like fetchUrlText, but also returns same-origin links (for the site crawler).
 * The final response URL is re-validated so a redirect can't smuggle the fetch
 * to a blocked host.
 */
export async function fetchUrlPage(url: string): Promise<{ title: string; text: string; links: string[] }> {
  const parsed = await assertPublicUrl(url);

  const res = await fetch(url, {
    headers: { "user-agent": "ClevarBot/1.0 (+knowledge-import)", accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error("FETCH_FAILED");
  // Redirects can hop hosts — re-validate where we actually landed.
  const finalUrl = await assertPublicUrl(res.url || url);

  const html = (await res.text()).slice(0, 2_000_000);
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch?.[1] || parsed.hostname).trim().slice(0, 200);

  // Same-origin links, resolved and stripped of fragments; extracted BEFORE
  // tag stripping. Non-page assets are filtered by extension.
  const links: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    if (links.length >= 200) break;
    try {
      const u = new URL(m[1], finalUrl);
      u.hash = "";
      if (u.protocol !== finalUrl.protocol && !/^https?:$/.test(u.protocol)) continue;
      if (u.origin !== finalUrl.origin) continue;
      if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|gz|mp4|mp3|woff2?|ttf|pdf|docx?)$/i.test(u.pathname)) continue;
      const href = u.toString();
      if (!seen.has(href)) {
        seen.add(href);
        links.push(href);
      }
    } catch {
      /* unparseable href */
    }
  }

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

  return { title, text, links };
}

/** Fetches and parses robots.txt "User-agent: *" Disallow rules (best-effort). */
export async function fetchRobotsDisallow(origin: string): Promise<string[]> {
  try {
    await assertPublicUrl(`${origin}/robots.txt`);
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": "ClevarBot/1.0 (+knowledge-import)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.text()).slice(0, 100_000);
    const rules: string[] = [];
    let applies = false;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim();
      const ua = line.match(/^user-agent:\s*(.+)$/i);
      if (ua) {
        applies = ua[1].trim() === "*";
        continue;
      }
      if (!applies) continue;
      const dis = line.match(/^disallow:\s*(.*)$/i);
      if (dis) {
        const path = dis[1].trim();
        if (path) rules.push(path);
      }
    }
    return rules.slice(0, 100);
  } catch {
    return [];
  }
}

/** Fetches sitemap.xml <loc> entries for the origin (best-effort, same-origin only). */
export async function fetchSitemapUrls(origin: string, cap: number): Promise<string[]> {
  try {
    await assertPublicUrl(`${origin}/sitemap.xml`);
    const res = await fetch(`${origin}/sitemap.xml`, {
      headers: { "user-agent": "ClevarBot/1.0 (+knowledge-import)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = (await res.text()).slice(0, 2_000_000);
    const urls: string[] = [];
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (urls.length >= cap) break;
      try {
        const u = new URL(m[1]);
        if (u.origin === origin && /^https?:$/.test(u.protocol)) {
          u.hash = "";
          urls.push(u.toString());
        }
      } catch {
        /* skip */
      }
    }
    return urls;
  } catch {
    return [];
  }
}
