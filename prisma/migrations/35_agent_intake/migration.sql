-- Required intake fields: ordered object.key list the agent collects before assisting.
ALTER TABLE "ai_agents" ADD COLUMN "intake_fields" jsonb NOT NULL DEFAULT '[]'::jsonb;
