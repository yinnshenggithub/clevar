import { streamText, convertToCoreMessages, type Message } from "ai";
import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { resolveModel } from "@/lib/ai";
import { MODEL_OPTIONS } from "@/lib/ai-models";
import { getCredits, creditsForTokens, debitCredits } from "@/lib/credits";
import { retrieveContext } from "@/lib/knowledge";
import { buildAgentSystemPrompt, styleMaxTokens, type AgentConfig } from "@/lib/agent-presets";
import { buildActionTools, type AgentActions } from "@/lib/agent-actions";

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

  // Dry-run action tools: the model can "call" the agent's enabled actions so the
  // tester shows what it would do, but nothing mutates live data.
  const actions = (agent.actions && typeof agent.actions === "object" ? agent.actions : {}) as unknown as AgentActions;
  const [members, labels] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId }, include: { user: { select: { id: true, fullName: true } } } }),
    withTenant(ctx.workspaceId, (tx) => tx.label.findMany({ select: { id: true, name: true } })),
  ]);
  const { tools } = buildActionTools({
    workspaceId: ctx.workspaceId,
    actions,
    members: members.map((m) => ({ id: m.user.id, name: m.user.fullName })),
    labels,
    dryRun: true,
  });
  const hasTools = Object.keys(tools).length > 0;

  const result = streamText({
    model: resolveModel(model),
    system: buildAgentSystemPrompt(config, context),
    messages: convertToCoreMessages(messages),
    temperature: agent.temperature,
    maxTokens: styleMaxTokens(agent.responseStyle),
    ...(hasTools ? { tools, maxSteps: 5 } : {}),
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
