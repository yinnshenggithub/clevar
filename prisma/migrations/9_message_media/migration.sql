-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "media_filename" TEXT,
ADD COLUMN     "media_id" TEXT,
ADD COLUMN     "media_mime" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'text';

