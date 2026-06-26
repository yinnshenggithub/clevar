-- CreateEnum
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE';

