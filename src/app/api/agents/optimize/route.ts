import { generateText } from "ai";
import { getAuthContext } from "@/lib/auth";
import { resolveModel } from "@/lib/ai";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { getCredits, creditsForTokens, debitCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const maxDuration = 30;

// Rewrites an instruction / action guideline into clearer, more actionable wording.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return Response.json({ error: "No AI provider key configured." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const text: string = typeof body.text === "string" ? body.text.trim() : "";
  const kind: string = body.kind === "guideline" ? "guideline" : "instructions";
  if (!text) return Response.json({ error: "Nothing to optimize." }, { status: 400 });
  if (text.length > 6000) return Response.json({ error: "Too long to optimize." }, { status: 400 });

  const credits = await getCredits(ctx.workspaceId);
  if (credits.remaining <= 0) {
    return Response.json({ error: "Out of AI credits for this period." }, { status: 402 });
  }

  const system =
    kind === "guideline"
      ? `You rewrite an AI support/sales agent ACTION guideline so it's clear and actionable: when the action should fire and how. Keep it to 1–3 short sentences, imperative voice, concrete conditions. Output ONLY the rewritten guideline — no preamble, quotes, or markdown.`
      : `You rewrite instructions for an AI customer support/sales agent so they're clear, well-structured, and actionable. Keep the operator's intent and any specifics (URLs, names, prices). Prefer short labelled sections and bullet points. Be concise. Output ONLY the rewritten instructions — no preamble, quotes, or markdown fences.`;

  try {
    const { text: improved, usage } = await generateText({
      model: resolveModel(DEFAULT_MODEL),
      system,
      prompt: text,
      temperature: 0.3,
      maxTokens: 700,
    });
    await debitCredits(ctx.workspaceId, creditsForTokens(usage?.totalTokens ?? 0), {
      tokensIn: usage?.promptTokens ?? 0,
      tokensOut: usage?.completionTokens ?? 0,
    });
    return Response.json({ text: improved.trim() });
  } catch (e) {
    console.error("optimize failed", e);
    return Response.json({ error: "Could not optimize right now." }, { status: 500 });
  }
}
