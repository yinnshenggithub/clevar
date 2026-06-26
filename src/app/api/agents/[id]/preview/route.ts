import { streamText, convertToCoreMessages, type Message } from "ai";
import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { resolveModel } from "@/lib/ai";
import { MODEL_OPTIONS } from "@/lib/ai-models";
import { getCredits, creditsForTokens, debitCredits } from "@/lib/credits";
import { retrieveContext } from "@/lib/knowledge";
import { buildAgentSystemPrompt, styleMaxTokens, type AgentConfig } from "@/lib/agent-presets";

export const runtime = "nodejs";
export const maxDuration = 60;

// Studio test harness: streams a reply using the agent's FULL studio configuration
// (tone/mode/objectives/constraints/style + knowledge-base grounding) and a model
// chosen at test time. Nothing is persisted — this is a throwaway preview — but it
// is a real model call, so it meters credits like production traffic.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];

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

  // Only honor a model the workspace can actually pick; otherwise use the saved one.
  const requested = typeof body.model === "string" ? body.model : "";
  const model = MODEL_OPTIONS.some((m) => m.value === requested) ? requested : agent.model;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const context = await retrieveContext(ctx.workspaceId, agentId, lastUserText);

  const config: AgentConfig = {
    name: agent.name,
    mode: agent.mode,
    tone: agent.tone,
    responseStyle: agent.responseStyle,
    objectives: agent.objectives,
    constraints: agent.constraints,
    greeting: agent.greeting,
    instructions: agent.instructions,
    handoffEnabled: agent.handoffEnabled,
  };

  const result = streamText({
    model: resolveModel(model),
    system: buildAgentSystemPrompt(config, context),
    messages: convertToCoreMessages(messages),
    temperature: agent.temperature,
    maxTokens: styleMaxTokens(agent.responseStyle),
    onFinish: async ({ usage }) => {
      try {
        const tokensIn = usage?.promptTokens ?? 0;
        const tokensOut = usage?.completionTokens ?? 0;
        const cost = creditsForTokens(usage?.totalTokens ?? tokensIn + tokensOut);
        await debitCredits(ctx.workspaceId, cost, { agentId, tokensIn, tokensOut });
      } catch (e) {
        console.error("agent preview onFinish failed", e);
      }
    },
  });

  return result.toDataStreamResponse();
}
