-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

-- AlterTable
ALTER TABLE "custom_field_defs" ADD COLUMN     "default_value" TEXT,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "custom_records" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

