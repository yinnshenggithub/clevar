import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { metaConfigured, metaAuthUrl } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export async function GET() {
  await requireAuth();
  if (!metaConfigured()) {
    return NextResponse.redirect(`${appUrl()}/app/inbox/channels?error=meta_not_configured`);
  }
  const nonce = randomUUID();
  (await cookies()).set("oauth_nonce_meta", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return NextResponse.redirect(metaAuthUrl(nonce));
}
