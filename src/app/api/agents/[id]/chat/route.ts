import { streamText, convertToCoreMessages, type Message } from "ai";
import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { resolveModel } from "@/lib/ai";
import { getCredits, creditsForTokens, debitCredits } from "@/lib/credits";
import { retrieveContext, buildSystemPrompt } from "@/lib/knowledge";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];
  const conversationId: string | undefined = body.conversationId;

  const agent = await withTenant(ctx.workspaceId, (tx) =>
    tx.aiAgent.findFirst({ where: { id: agentId, deletedAt: null } }),
  );
  if (!agent) return new Response("Agent not found", { status: 404 });

  const credits = await getCredits(ctx.workspaceId);
  if (credits.remaining <= 0) {
    return new Response(
      JSON.stringify({ error: "This workspace is out of AI credits for the current period." }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const context = await retrieveContext(ctx.workspaceId, agentId, lastUserText);
  const baseSystem =
    agent.instructions?.trim() ||
    `You are ${agent.name}, a helpful AI assistant inside a CRM workspace. Be concise and accurate.`;

  const result = streamText({
    model: resolveModel(agent.model),
    system: buildSystemPrompt(baseSystem, context),
    messages: convertToCoreMessages(messages),
    onFinish: async ({ text, usage }) => {
      const tokensIn = usage?.promptTokens ?? 0;
      const tokensOut = usage?.completionTokens ?? 0;
      const cost = creditsForTokens(usage?.totalTokens ?? tokensIn + tokensOut);
      try {
        if (conversationId) {
          await withTenant(ctx.workspaceId, async (tx) => {
            const convo = await tx.aiConversation.findFirst({
              where: { id: conversationId, agentId },
            });
            if (!convo) return;
            if (lastUser?.content) {
              await tx.aiMessage.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  conversationId,
                  role: "USER",
                  content: String(lastUser.content),
                },
              });
            }
            await tx.aiMessage.create({
              data: {
                workspaceId: ctx.workspaceId,
                conversationId,
                role: "ASSISTANT",
                content: text,
              },
            });
            if (convo.title === "New chat" && lastUser?.content) {
              await tx.aiConversation.update({
                where: { id: conversationId },
                data: { title: String(lastUser.content).slice(0, 60) },
              });
            }
          });
        }
        await debitCredits(ctx.workspaceId, cost, { agentId, conversationId, tokensIn, tokensOut });
      } catch (e) {
        console.error("ai chat onFinish failed", e);
      }
    },
  });

  return result.toDataStreamResponse();
}
