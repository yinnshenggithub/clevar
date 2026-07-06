-- Structured prompt config for AI agents: do's/don'ts, scenario playbook,
-- few-shot examples, grounding mode, refusal line, language policy, and the
-- CRM-personalization field allowlist. All defaults preserve current behavior.

ALTER TABLE "ai_agents"
  ADD COLUMN "dos" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "donts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "playbook" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "examples" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "grounding" TEXT NOT NULL DEFAULT 'strict',
  ADD COLUMN "refusal_line" TEXT,
  ADD COLUMN "language_policy" TEXT NOT NULL DEFAULT 'mirror',
  ADD COLUMN "profile_fields" JSONB NOT NULL DEFAULT '[]';
