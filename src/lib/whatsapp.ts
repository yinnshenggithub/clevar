import { createHmac, timingSafeEqual } from "crypto";

const GRAPH_VERSION = "v21.0";

/** Sends a text message via the WhatsApp Cloud API. Returns the WA message id. */
export async function sendWhatsAppText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<string | undefined> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text.slice(0, 4000) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  }
  return data?.messages?.[0]?.id as string | undefined;
}

export type WaMediaType = "image" | "video" | "audio" | "document";

export function mediaTypeFromMime(mime: string): WaMediaType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Uploads a file to the Cloud API media store and returns its media id. */
export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  file: Blob,
  mime: string,
  filename = "upload",
): Promise<string> {
  const fd = new FormData();
  fd.set("messaging_product", "whatsapp");
  fd.set("type", mime);
  fd.set("file", file, filename);
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error(data?.error?.message || `WhatsApp media upload failed (${res.status})`);
  return data.id as string;
}

/** Sends a media message (by uploaded media id). Returns the WA message id. */
export async function sendWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  type: WaMediaType,
  mediaId: string,
  caption?: string,
  filename?: string,
): Promise<string | undefined> {
  const media: Record<string, string> = { id: mediaId };
  if (caption && (type === "image" || type === "video" || type === "document")) media.caption = caption;
  if (type === "document" && filename) media.filename = filename;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type, [type]: media }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp media send failed (${res.status})`);
  return data?.messages?.[0]?.id as string | undefined;
}

/** Verifies the X-Hub-Signature-256 header against the Meta app secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.slice("sha256=".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** WhatsApp sends phone numbers without a leading "+"; normalize to E.164-ish. */
export function waPhoneToE164(from: string): string {
  const digits = from.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : from;
}
