-- Race-safe WhatsApp message dedupe: Meta delivers at-least-once and history
-- backfill chunks run concurrently, so find-first-then-create is not enough.
-- Partial unique index (NULLs exempt) makes (workspace, wamid) the authority;
-- writers use createMany(skipDuplicates)/catch-P2002 against it.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_workspace_wamid_unique"
  ON "messages"("workspace_id", "wa_message_id")
  WHERE "wa_message_id" IS NOT NULL;
