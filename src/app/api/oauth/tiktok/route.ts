import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { tiktokConfigured, tiktokAuthUrl } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export async function GET() {
  await requireAuth();
  if (!tiktokConfigured()) {
    return NextResponse.redirect(`${appUrl()}/app/inbox/channels?error=tiktok_not_configured`);
  }
  const nonce = randomUUID();
  (await cookies()).set("oauth_nonce_tiktok", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return NextResponse.redirect(tiktokAuthUrl(nonce));
}
