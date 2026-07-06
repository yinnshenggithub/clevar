-- Handoff trigger config + customer-facing handoff message (design §3.5).
ALTER TABLE "ai_agents"
  ADD COLUMN "handoff_triggers" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "handoff_message" TEXT;
