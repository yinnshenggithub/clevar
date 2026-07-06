// Pure data (no provider SDK imports) so client components can use it safely.

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Labels carry the relative cost so tenants see price before choosing.
export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fast · lowest cost" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 — balanced · ~3× cost" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — smart · ~3× cost" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 — best · ~5× cost" },
  { value: "gpt-4o-mini", label: "GPT-4o mini — fast · low cost" },
];
