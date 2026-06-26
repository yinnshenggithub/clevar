import { after } from "next/server";
import { getEnabledWidget, addVisitorMessage } from "@/lib/webchat";
import { runWebchatAgentReply, hasLlmKey } from "@/lib/agent-reply";
import { evaluateAgentRules } from "@/lib/agent-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await getEnabledWidget(key);
  if (!widget) return Response.json({ error: "Widget not available" }, { status: 404 });

  let payload: { conversationId?: string; visitorId?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const body = (payload.body ?? "").toString().trim().slice(0, 4000);
  if (!body || !payload.conversationId || !payload.visitorId) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const ok = await addVisitorMessage(widget, payload.conversationId, payload.visitorId, body);
  if (!ok) return Response.json({ error: "Conversation not found" }, { status: 404 });

  // If-then rules first (work without an LLM); AI auto-reply only if not handed off.
  if (widget.autoReplyAgentId) {
    const agentId = widget.autoReplyAgentId;
    const wsId = widget.workspaceId;
    const convoId = payload.conversationId;
    after(async () => {
      try {
        const { handedOff } = await evaluateAgentRules({ workspaceId: wsId, conversationId: convoId, agentId, messageText: body });
        if (!handedOff && hasLlmKey()) {
          await runWebchatAgentReply({ workspaceId: wsId, conversationId: convoId, agentId });
        }
      } catch (e) {
        console.error("webchat rules/auto-reply failed", e);
      }
    });
  }

  return Response.json({ ok: true });
}
