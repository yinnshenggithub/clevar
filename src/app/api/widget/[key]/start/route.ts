import { randomUUID } from "crypto";
import { getEnabledWidget, startWebConversation } from "@/lib/webchat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await getEnabledWidget(key);
  if (!widget) return Response.json({ error: "Widget not available" }, { status: 404 });

  let payload: { visitorId?: string; name?: string } = {};
  try {
    payload = await req.json();
  } catch {
    /* empty body ok */
  }
  const visitorId = (payload.visitorId && /^[a-f0-9-]{8,64}$/i.test(payload.visitorId) ? payload.visitorId : null) || randomUUID();
  const name = (payload.name ?? "").toString().trim().slice(0, 80) || null;

  const { conversationId, messages } = await startWebConversation(widget, visitorId, name);
  return Response.json({
    visitorId,
    conversationId,
    messages,
    config: { name: widget.name, color: widget.color, welcome: widget.welcomeMessage },
  });
}
