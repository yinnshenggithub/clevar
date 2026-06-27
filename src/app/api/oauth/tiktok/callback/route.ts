import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tiktokExchangeAndListAdvertisers } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export async function GET(req: Request) {
  const ctx = await requireAuth();
  const url = new URL(req.url);
  // TikTok returns the code as `auth_code` (sometimes `code`).
  const code = url.searchParams.get("auth_code") || url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const nonce = jar.get("oauth_nonce_tiktok")?.value;
  jar.delete("oauth_nonce_tiktok");

  const dest = (q: string) => NextResponse.redirect(`${appUrl()}/app/inbox/channels?${q}`);
  if (!code || !state || !nonce || state !== nonce) return dest("error=oauth_state");

  try {
    const advertisers = await tiktokExchangeAndListAdvertisers(code);
    if (advertisers.length === 0) return dest("error=tiktok_no_advertisers");

    let connected = 0;
    for (const a of advertisers) {
      const existing = await prisma.channelConnection.findUnique({
        where: { provider_externalId: { provider: "tiktok", externalId: a.id } },
      });
      if (existing && existing.workspaceId !== ctx.workspaceId) continue;
      const config = { advertiserName: a.name } as Prisma.InputJsonValue;
      await prisma.channelConnection.upsert({
        where: { provider_externalId: { provider: "tiktok", externalId: a.id } },
        update: { accessToken: a.accessToken, config, enabled: true },
        create: { workspaceId: ctx.workspaceId, provider: "tiktok", externalId: a.id, accessToken: a.accessToken, config },
      });
      connected++;
    }
    return dest(connected > 0 ? `connected=tiktok&count=${connected}` : "error=tiktok_no_advertisers");
  } catch (e) {
    console.error("tiktok oauth callback failed", e);
    return dest("error=tiktok_oauth_failed");
  }
}
