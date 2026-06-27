import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { metaExchangeAndListPages } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export async function GET(req: Request) {
  const ctx = await requireAuth();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const nonce = jar.get("oauth_nonce_meta")?.value;
  jar.delete("oauth_nonce_meta");

  const dest = (q: string) => NextResponse.redirect(`${appUrl()}/app/inbox/channels?${q}`);
  if (!code || !state || !nonce || state !== nonce) return dest("error=oauth_state");

  try {
    const pages = await metaExchangeAndListPages(code);
    if (pages.length === 0) return dest("error=meta_no_pages");

    let connected = 0;
    for (const p of pages) {
      const existing = await prisma.channelConnection.findUnique({
        where: { provider_externalId: { provider: "meta", externalId: p.id } },
      });
      if (existing && existing.workspaceId !== ctx.workspaceId) continue; // owned elsewhere
      const config = {
        pageName: p.name,
        igUserId: p.igUserId,
        features: { messenger: true, instagram: Boolean(p.igUserId), leadgen: true },
      } as Prisma.InputJsonValue;
      await prisma.channelConnection.upsert({
        where: { provider_externalId: { provider: "meta", externalId: p.id } },
        update: { accessToken: p.accessToken, config, enabled: true },
        create: { workspaceId: ctx.workspaceId, provider: "meta", externalId: p.id, accessToken: p.accessToken, config },
      });
      connected++;
    }
    return dest(connected > 0 ? `connected=meta&count=${connected}` : "error=meta_no_pages");
  } catch (e) {
    console.error("meta oauth callback failed", e);
    return dest("error=meta_oauth_failed");
  }
}
