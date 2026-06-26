-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]';

