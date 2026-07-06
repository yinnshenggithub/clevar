import "server-only";

/**
 * WhatsApp Coexistence — Meta's official path for connecting an EXISTING
 * WhatsApp Business app number to the Cloud API (both keep working on the same
 * number). Onboarding happens through Meta's Embedded Signup popup; this module
 * holds the server side of that flow: auth-code exchange, WABA discovery,
 * webhook subscription, and the one-time contact/history sync trigger.
 *
 * Going live requires (server env):
 *   NEXT_PUBLIC_META_APP_ID       — Meta app id (also used by the browser SDK).
 *   META_APP_SECRET               — the same app's secret (shared with oauth.ts).
 *   NEXT_PUBLIC_META_ES_CONFIG_ID — Facebook Login for Business configuration id
 *                                   created from the "WhatsApp Embedded Signup
 *                                   Configuration" template.
 * Until all are set the connect UI stays hidden and the webhook branches are
 * inert. Setup + Meta approval runbook: docs/meta-coexistence-approval.md.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

function appId(): string | undefined {
  return process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID;
}

export function coexConfigured(): boolean {
  return Boolean(appId() && process.env.META_APP_SECRET && process.env.NEXT_PUBLIC_META_ES_CONFIG_ID);
}

/** Values the browser Embedded Signup component needs (none are secrets). */
export function coexClientConfig(): { appId: string; configId: string } | null {
  const id = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
  if (!id || !configId || !process.env.META_APP_SECRET) return null;
  return { appId: id, configId };
}

async function graphJson(res: Response, what: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ? `${what}: ${data.error.message}` : `${what} failed (${res.status})`);
  }
  return data;
}

/**
 * Exchange the Embedded Signup auth code for a business integration access
 * token (long-lived; scoped to the customer's WABA). No redirect_uri — ES
 * business codes are exchanged directly.
 */
export async function exchangeEsCode(code: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId()!,
        client_secret: process.env.META_APP_SECRET!,
        code,
      }),
  );
  const data = await graphJson(res, "Token exchange");
  if (!data.access_token) throw new Error("Token exchange returned no access token");
  return data.access_token as string;
}

export interface WabaPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

/** Lists the phone numbers on a WABA (a coexistence WABA has exactly one). */
export async function getWabaPhoneNumbers(wabaId: string, accessToken: string): Promise<WabaPhoneNumber[]> {
  const res = await fetch(
    `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await graphJson(res, "Phone number lookup");
  return ((data.data ?? []) as any[]).map((p) => ({
    id: String(p.id),
    displayPhoneNumber: p.display_phone_number ?? null,
    verifiedName: p.verified_name ?? null,
  }));
}

/** Subscribes our app to the customer WABA so its webhooks reach us. */
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await graphJson(res, "Webhook subscription");
}

/** Best-effort unsubscribe when a channel is disconnected in Clevar. */
export async function unsubscribeAppFromWaba(wabaId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    /* the row is going away regardless */
  }
}

export type SmbSyncType = "history" | "smb_app_state_sync";

/**
 * Triggers the one-time sync of app data into our webhooks — "history" for up
 * to 180 days of chats, "smb_app_state_sync" for the contact book. Meta
 * requires this within 24h of onboarding, else the client must be offboarded.
 */
export async function requestSmbAppSync(
  phoneNumberId: string,
  accessToken: string,
  syncType: SmbSyncType,
): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/smb_app_data`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
  });
  await graphJson(res, `Sync request (${syncType})`);
}

/**
 * Registers a NEW Cloud API number for messaging (standard Embedded Signup
 * only). Coexistence numbers must skip this — they are already registered to
 * the phone app. Sets a random two-step PIN; if the number already has one this
 * fails and the caller treats it as "finish registration in WhatsApp Manager".
 */
export async function registerCloudNumber(phoneNumberId: string, accessToken: string): Promise<void> {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const res = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  await graphJson(res, "Number registration");
}
