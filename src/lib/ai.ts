import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { DEFAULT_MODEL } from "./ai-models";

export { DEFAULT_MODEL, MODEL_OPTIONS } from "./ai-models";

/** Maps a stored model id to a configured Vercel AI SDK model. */
export function resolveModel(model: string): LanguageModelV1 {
  const id = (model || DEFAULT_MODEL).trim();
  if (/^(gpt|o1|o3|openai\/)/i.test(id)) {
    return openai(id.replace(/^openai\//, ""));
  }
  return anthropic(id.replace(/^anthropic\//, ""));
}
