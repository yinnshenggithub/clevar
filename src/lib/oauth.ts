import "server-only";

/**
 * App-owned OAuth for Meta and TikTok. Users click "Connect" and grant access to
 * Clevar's registered app — they never create their own developer app. The flow
 * produces the same ChannelConnection rows the manual forms create.
 *
 * Going live requires (set in the server env):
 *   META_APP_ID, META_APP_SECRET          — a Meta app with Facebook Login + the
 *                                            scopes below, in Live mode (App Review).
 *   TIKTOK_APP_ID, TIKTOK_APP_SECRET       — a TikTok for Business app.
 * Until those are set, the connect buttons stay hidden and the manual forms remain.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const META_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "leads_retrieval",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
].join(",");

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && baseUrl());
}

export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET && baseUrl());
}

export const metaRedirectUri = () => `${baseUrl()}/api/oauth/meta/callback`;
export const tiktokRedirectUri = () => `${baseUrl()}/api/oauth/tiktok/callback`;

export function metaAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: metaRedirectUri(),
    state,
    scope: META_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p.toString()}`;
}

export function tiktokAuthUrl(state: string): string {
  const p = new URLSearchParams({
    app_id: process.env.TIKTOK_APP_ID!,
    state,
    redirect_uri: tiktokRedirectUri(),
  });
  return `https://business-api.tiktok.com/portal/auth?${p.toString()}`;
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  igUserId: string | null;
}

/** Exchange an auth code for a long-lived user token, then list the user's Pages. */
export async function metaExchangeAndListPages(code: string): Promise<MetaPage[]> {
  const tokenRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: metaRedirectUri(),
        code,
      }),
  );
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: unknown };
  if (!tokenJson.access_token) throw new Error("meta_token_exchange_failed");

  // Trade the short-lived token for a long-lived one (Page tokens derived from it persist).
  const llRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: tokenJson.access_token,
      }),
  );
  const llJson = (await llRes.json()) as { access_token?: string };
  const userToken = llJson.access_token || tokenJson.access_token;

  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?` +
      new URLSearchParams({
        fields: "id,name,access_token,instagram_business_account",
        access_token: userToken,
        limit: "100",
      }),
  );
  const pagesJson = (await pagesRes.json()) as {
    data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[];
  };
  return (pagesJson.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    igUserId: p.instagram_business_account?.id ?? null,
  }));
}

export interface TikTokAdvertiser {
  id: string;
  name: string;
  accessToken: string;
}

/** Exchange a TikTok auth code for an access token and the authorized advertiser accounts. */
export async function tiktokExchangeAndListAdvertisers(code: string): Promise<TikTokAdvertiser[]> {
  const tokenRes = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.TIKTOK_APP_ID,
      secret: process.env.TIKTOK_APP_SECRET,
      auth_code: code,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { data?: { access_token?: string; advertiser_ids?: string[] } };
  const accessToken = tokenJson.data?.access_token;
  const ids = tokenJson.data?.advertiser_ids ?? [];
  if (!accessToken || ids.length === 0) throw new Error("tiktok_token_exchange_failed");

  // Best-effort advertiser names.
  const names = new Map<string, string>();
  try {
    const infoRes = await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?" +
        new URLSearchParams({ access_token: accessToken, app_id: process.env.TIKTOK_APP_ID!, secret: process.env.TIKTOK_APP_SECRET! }),
      { headers: { "Access-Token": accessToken } },
    );
    const infoJson = (await infoRes.json()) as { data?: { list?: { advertiser_id: string; advertiser_name: string }[] } };
    for (const a of infoJson.data?.list ?? []) names.set(a.advertiser_id, a.advertiser_name);
  } catch {
    /* names are optional */
  }

  return ids.map((id) => ({ id, name: names.get(id) ?? `Advertiser ${id}`, accessToken }));
}
