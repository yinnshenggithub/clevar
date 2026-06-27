-- Agent Actions config: per-action { enabled, guideline } map on the agent.
ALTER TABLE "ai_agents" ADD COLUMN "actions" JSONB NOT NULL DEFAULT '{}';
