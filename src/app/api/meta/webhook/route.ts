import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/whatsapp";
import { fetchMetaProfileName, fetchMetaLead } from "@/lib/meta";
import { persistSocialInbound, createLeadContact } from "@/lib/social-inbox";
import { evaluateAgentRules } from "@/lib/agent-rules";
import { runMetaAgentReply, hasLlmKey } from "@/lib/agent-reply";

export const runtime = "nodejs";
export const maxDuration = 60;

function metaVerifyToken(): string | undefined {
  return process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
}

// Meta webhook verification handshake (shared by Messenger, Instagram, Lead Ads).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === metaVerifyToken()) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Conn = { workspaceId: string; accessToken: string; autoReplyAgentId: string | null };

async function processSocial(conn: Conn, conversationId: string, assignedAgentId: string | null, recipientId: string, text: string) {
  if (!assignedAgentId) return;
  const { handedOff } = await evaluateAgentRules({ workspaceId: conn.workspaceId, conversationId, agentId: assignedAgentId, messageText: text });
  if (handedOff) return;
  if (hasLlmKey()) {
    await runMetaAgentReply({ workspaceId: conn.workspaceId, conversationId, agentId: assignedAgentId, pageAccessToken: conn.accessToken, recipientId });
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && !verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const isInstagram = body.object === "instagram";

  for (const entry of body.entry ?? []) {
    // Direct messages (Messenger + Instagram share this structure).
    for (const ev of entry.messaging ?? []) {
      const text: string | undefined = ev.message?.text;
      if (!text || ev.message?.is_echo) continue;
      const senderId = String(ev.sender?.id ?? "");
      const recipientId = String(ev.recipient?.id ?? "");
      if (!senderId || !recipientId) continue;

      const conn = isInstagram
        ? await prisma.channelConnection.findFirst({ where: { provider: "meta", enabled: true, config: { path: ["igUserId"], equals: recipientId } } })
        : await prisma.channelConnection.findFirst({ where: { provider: "meta", enabled: true, externalId: recipientId } });
      if (!conn) continue;

      const channelType = isInstagram ? "instagram" : "messenger";
      const key = `${isInstagram ? "ig" : "fb"}:${senderId}`;
      const name = isInstagram ? null : await fetchMetaProfileName(conn.accessToken, senderId);
      const { conversationId, assignedAgentId } = await persistSocialInbound({
        workspaceId: conn.workspaceId,
        channelType,
        customerKey: key,
        name,
        body: text,
        autoReplyAgentId: conn.autoReplyAgentId,
      });
      const c: Conn = { workspaceId: conn.workspaceId, accessToken: conn.accessToken, autoReplyAgentId: conn.autoReplyAgentId };
      after(() => processSocial(c, conversationId, assignedAgentId, senderId, text).catch((e) => console.error("meta processSocial failed", e)));
    }

    // Lead Ads submissions.
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen") continue;
      const v = ch.value ?? {};
      const pageId = String(v.page_id ?? "");
      const conn = await prisma.channelConnection.findFirst({ where: { provider: "meta", enabled: true, externalId: pageId } });
      if (!conn || !v.leadgen_id) continue;
      const token = conn.accessToken;
      const wsId = conn.workspaceId;
      const leadgenId = String(v.leadgen_id);
      const formId = v.form_id ? String(v.form_id) : null;
      after(async () => {
        try {
          const lead = await fetchMetaLead(leadgenId, token);
          if (lead) await createLeadContact(wsId, lead, "Meta Lead Ad", formId);
        } catch (e) {
          console.error("meta leadgen failed", e);
        }
      });
    }
  }

  return new Response("ok", { status: 200 });
}
