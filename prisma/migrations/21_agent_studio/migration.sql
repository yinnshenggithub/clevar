-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "constraints" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "greeting" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "handoff_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "handoff_user_id" UUID,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'support',
ADD COLUMN     "objectives" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "response_style" TEXT NOT NULL DEFAULT 'balanced',
ADD COLUMN     "rules" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "tone" TEXT NOT NULL DEFAULT 'friendly';

