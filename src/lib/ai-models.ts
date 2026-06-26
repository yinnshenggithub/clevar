// Pure data (no provider SDK imports) so client components can use it safely.

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 (smart)" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
];
