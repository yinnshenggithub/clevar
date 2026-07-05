import "server-only";
import crypto from "crypto";
import { mediaTypeFromMime, type WaMediaType } from "./whatsapp";

/**
 * Client for the messaging gateway that hosts web-linked WhatsApp sessions
 * (numbers paired via QR / pairing code from the WhatsApp or WhatsApp Business
 * app). The gateway is an external always-on service; this app talks to it over
 * HTTP and receives events on /api/wa-web/events.
 *
 * Env: WA_WEB_GATEWAY_URL, WA_WEB_GATEWAY_API_KEY, WA_WEB_WEBHOOK_SECRET.
 * The feature is inert until all three are set (waWebConfigured()).
 */

function baseUrl(): string {
  return (process.env.WA_WEB_GATEWAY_URL ?? "").replace(/\/+$/, "");
}
function apiKey(): string {
  return process.env.WA_WEB_GATEWAY_API_KEY ?? "";
}
function webhookSecret(): string {
  return process.env.WA_WEB_WEBHOOK_SECRET ?? "";
}

export function waWebConfigured(): boolean {
  return Boolean(baseUrl() && apiKey() && webhookSecret());
}

async function gw(path: string, init?: RequestInit): Promise<Response> {
  if (!baseUrl() || !apiKey()) throw new Error("Messaging gateway is not configured.");
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": apiKey(),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/* ─────────────────────────── session lifecycle ─────────────────────────── */

export type WaWebStatus = "starting" | "scan_qr" | "working" | "failed" | "logged_out" | "stopped";

/** Gateway status enum → our channel status values. */
export function mapGatewayStatus(s: string | undefined | null): WaWebStatus {
  switch ((s ?? "").toUpperCase()) {
    case "WORKING":
      return "working";
    case "SCAN_QR_CODE":
      return "scan_qr";
    case "STARTING":
      return "starting";
    case "FAILED":
      return "failed";
    case "STOPPED":
      return "stopped";
    default:
      return "starting";
  }
}

/** Create (or restart) a session on the gateway and start pairing. */
export async function createGatewaySession(sessionName: string, appBaseUrl: string): Promise<void> {
  const existing = await gw(`/api/sessions/${encodeURIComponent(sessionName)}`);
  if (existing.ok) {
    // Already known to the gateway → restart so a fresh QR is issued.
    const res = await gw(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: "POST" });
    if (!res.ok) throw new Error(`Gateway session restart failed (${res.status}): ${await safeText(res)}`);
    return;
  }
  const res = await gw(`/api/sessions`, {
    method: "POST",
    body: JSON.stringify({
      name: sessionName,
      start: true,
      config: {
        // Status stories, channels, and broadcasts aren't inbox conversations.
        ignore: { status: true, broadcast: true, channels: true },
        webhooks: [
          {
            // message.any covers inbound AND messages sent from the linked
            // phone itself, so the inbox mirrors the full thread.
            url: `${appBaseUrl}/api/wa-web/events`,
            events: ["message.any", "session.status"],
            hmac: { key: webhookSecret() },
            retries: { policy: "exponential", delaySeconds: 2, attempts: 3 },
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`Gateway session create failed (${res.status}): ${await safeText(res)}`);
}

export async function getGatewaySession(
  sessionName: string,
): Promise<{ status: WaWebStatus; meId: string | null; mePushName: string | null } | null> {
  const res = await gw(`/api/sessions/${encodeURIComponent(sessionName)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gateway session fetch failed (${res.status})`);
  const j = (await res.json()) as { status?: string; me?: { id?: string; pushName?: string } | null };
  return {
    status: mapGatewayStatus(j.status),
    meId: j.me?.id ?? null,
    mePushName: j.me?.pushName ?? null,
  };
}

/** Current QR for a pairing session, as a data: URL ready for an <img>. Null when no QR is available. */
export async function getGatewayQr(sessionName: string): Promise<string | null> {
  const res = await gw(`/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { mimetype?: string; data?: string } | null;
  if (!j?.data) return null;
  return `data:${j.mimetype || "image/png"};base64,${j.data}`;
}

/** Request an 8-char pairing code for "link with phone number" (no camera needed). */
export async function requestGatewayPairingCode(sessionName: string, phoneE164: string): Promise<string | null> {
  const digits = phoneE164.replace(/\D/g, "");
  const res = await gw(`/api/${encodeURIComponent(sessionName)}/auth/request-code`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber: digits }),
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { code?: string } | null;
  return j?.code ?? null;
}

export async function restartGatewaySession(sessionName: string): Promise<void> {
  const res = await gw(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: "POST" });
  if (!res.ok) throw new Error(`Gateway session restart failed (${res.status}): ${await safeText(res)}`);
}

/** Sign out the device on WhatsApp's side and drop gateway auth state. */
export async function logoutGatewaySession(sessionName: string): Promise<void> {
  await gw(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, { method: "POST" }).catch(() => undefined);
}

export async function deleteGatewaySession(sessionName: string): Promise<void> {
  await gw(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: "DELETE" }).catch(() => undefined);
}

/* ─────────────────────────────── sending ────────────────────────────────── */

type SendResponse = { id?: { id?: string; _serialized?: string } | string; key?: { id?: string } };

function extractMessageId(j: SendResponse | null): string | undefined {
  if (!j) return undefined;
  if (typeof j.id === "string") return j.id;
  return j.id?._serialized ?? j.id?.id ?? j.key?.id ?? undefined;
}

export async function sendGatewayText(sessionName: string, chatId: string, text: string): Promise<string | undefined> {
  const res = await gw(`/api/sendText`, {
    method: "POST",
    body: JSON.stringify({ session: sessionName, chatId, text: text.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`Gateway send failed (${res.status}): ${await safeText(res)}`);
  return extractMessageId((await res.json().catch(() => null)) as SendResponse | null);
}

const MEDIA_ENDPOINT: Record<WaMediaType, string> = {
  image: "/api/sendImage",
  video: "/api/sendVideo",
  audio: "/api/sendVoice",
  document: "/api/sendFile",
};

/** Send a file (as base64) through the gateway; returns the provider message id. */
export async function sendGatewayMedia(
  sessionName: string,
  chatId: string,
  file: { data: Buffer; mimetype: string; filename: string },
  caption?: string,
): Promise<string | undefined> {
  const kind = mediaTypeFromMime(file.mimetype);
  const body: Record<string, unknown> = {
    session: sessionName,
    chatId,
    file: { mimetype: file.mimetype, filename: file.filename, data: file.data.toString("base64") },
  };
  if (caption && (kind === "image" || kind === "video" || kind === "document")) body.caption = caption;
  // Voice notes must be OGG/Opus; let the gateway transcode other audio.
  if (kind === "audio" && !/ogg/i.test(file.mimetype)) body.convert = true;
  const res = await gw(MEDIA_ENDPOINT[kind], { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gateway media send failed (${res.status}): ${await safeText(res)}`);
  return extractMessageId((await res.json().catch(() => null)) as SendResponse | null);
}

/* ─────────────────────────────── media proxy ────────────────────────────── */

export const WA_WEB_MEDIA_PREFIX = "ww:";

/** Store gateway media references relative to the gateway when possible so the base URL can change. */
export function toStoredMediaId(mediaUrl: string): string {
  const base = baseUrl();
  const rel = base && mediaUrl.startsWith(base) ? mediaUrl.slice(base.length) : mediaUrl;
  return `${WA_WEB_MEDIA_PREFIX}${rel}`;
}

/** Fetch a stored `ww:` media reference from the gateway (streams the body). */
export async function fetchGatewayMedia(storedMediaId: string): Promise<Response> {
  const ref = storedMediaId.slice(WA_WEB_MEDIA_PREFIX.length);
  const url = /^https?:\/\//i.test(ref) ? ref : `${baseUrl()}${ref}`;
  // Only ever send the API key to the gateway itself.
  if (!url.startsWith(`${baseUrl()}/`)) return new Response("Not found", { status: 404 });
  return fetch(url, { headers: { "X-Api-Key": apiKey() }, cache: "no-store" });
}

/* ─────────────────────────── webhook verification ───────────────────────── */

/** Verify the gateway webhook HMAC (hex SHA-512 over the raw body). Strict: false when secret unset. */
export function verifyGatewayWebhook(rawBody: string, signature: string | null): boolean {
  const secret = webhookSecret();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ─────────────────────────────── identities ─────────────────────────────── */

/** +60123456789 → 60123456789@c.us */
export function phoneToChatId(phoneE164: string): string {
  return `${phoneE164.replace(/\D/g, "")}@c.us`;
}

/**
 * Chat/participant id → E.164 phone. Tolerates device/agent-suffixed JIDs
 * (e.g. 60123456789:12@s.whatsapp.net, common for the session's own id).
 * Returns null for group, broadcast, newsletter, and privacy-id ("lid")
 * addresses we can't map to a phone.
 */
export function chatIdToPhone(chatId: string | undefined | null): string | null {
  if (!chatId) return null;
  const m = chatId.match(/^(\d{5,20})(?:[._]\d+)?(?::\d+)?@(c\.us|s\.whatsapp\.net)$/);
  return m ? `+${m[1]}` : null;
}

/** Session names are the cross-workspace routing key; unguessable. */
export function newSessionName(): string {
  return `clv_${crypto.randomBytes(9).toString("hex")}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
