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
