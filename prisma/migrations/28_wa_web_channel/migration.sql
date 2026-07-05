-- Web-linked WhatsApp channels (paired via the messaging gateway with QR /
-- pairing code). Control-plane table: NO RLS — gateway events resolve the
-- workspace by session_name before any tenant context exists (same rationale
-- as whatsapp_channels / channel_connections).
CREATE TABLE "wa_web_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "session_name" TEXT NOT NULL,
    "phone_number" TEXT,
    "display_name" TEXT NOT NULL DEFAULT 'WhatsApp',
    "status" TEXT NOT NULL DEFAULT 'starting',
    "auto_reply_agent_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_web_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wa_web_channels_session_name_key" ON "wa_web_channels"("session_name");
CREATE INDEX "wa_web_channels_workspace_id_idx" ON "wa_web_channels"("workspace_id");

ALTER TABLE "wa_web_channels"
    ADD CONSTRAINT "wa_web_channels_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-conversation channel binding: which channel row the conversation belongs
-- to (polymorphic across whatsapp_channels / wa_web_channels /
-- channel_connections; NULL for legacy rows). ALTER on an RLS table keeps its
-- existing policy + trigger (see 9_message_media precedent).
ALTER TABLE "conversations" ADD COLUMN "channel_id" UUID;
