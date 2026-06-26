import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeTikTokLead } from "@/lib/tiktok";
import { createLeadContact } from "@/lib/social-inbox";

export const runtime = "nodejs";
export const maxDuration = 60;

// TikTok webhook verification: echo the challenge (and accept a verify token if present).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const challenge = url.searchParams.get("challenge") ?? url.searchParams.get("hub.challenge");
  if (challenge) return new Response(challenge, { status: 200 });
  return new Response("ok", { status: 200 });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  const { advertiserId, formId, lead } = normalizeTikTokLead(body);
  if (lead.email || lead.phone || lead.fullName || lead.firstName) {
    const conn =
      (advertiserId
        ? await prisma.channelConnection.findFirst({ where: { provider: "tiktok", enabled: true, externalId: advertiserId } })
        : null) ?? (await prisma.channelConnection.findFirst({ where: { provider: "tiktok", enabled: true } }));
    if (conn) {
      after(() => createLeadContact(conn.workspaceId, lead, "TikTok Lead", formId).catch((e) => console.error("tiktok lead failed", e)));
    }
  }

  return new Response("ok", { status: 200 });
}
