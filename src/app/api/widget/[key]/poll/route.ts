import { getEnabledWidget, pollMessages } from "@/lib/webchat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await getEnabledWidget(key);
  if (!widget) return Response.json({ error: "Widget not available" }, { status: 404 });

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") ?? "";
  const visitorId = url.searchParams.get("visitorId") ?? "";
  const after = url.searchParams.get("after");
  if (!conversationId || !visitorId) return Response.json({ error: "Missing fields" }, { status: 400 });

  const messages = await pollMessages(widget, conversationId, visitorId, after);
  if (messages === null) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json({ messages });
}
