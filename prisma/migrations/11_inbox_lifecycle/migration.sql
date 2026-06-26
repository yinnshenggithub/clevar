-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterEnum
BEGIN;
CREATE TYPE "ConversationStatus_new" AS ENUM ('OPEN', 'PENDING', 'SNOOZED', 'RESOLVED');
ALTER TABLE "public"."conversations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "conversations" ALTER COLUMN "status" TYPE "ConversationStatus_new" USING (CASE WHEN "status"::text = 'CLOSED' THEN 'RESOLVED' ELSE "status"::text END::"ConversationStatus_new");
ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
DROP TYPE "public"."ConversationStatus_old";
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "custom_attributes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "first_reply_at" TIMESTAMPTZ,
ADD COLUMN     "priority" "ConversationPriority" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "snoozed_until" TIMESTAMPTZ,
ADD COLUMN     "waiting_since" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "author_user_id" UUID,
ADD COLUMN     "private" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "conversations_workspace_id_assigned_user_id_idx" ON "conversations"("workspace_id", "assigned_user_id");

