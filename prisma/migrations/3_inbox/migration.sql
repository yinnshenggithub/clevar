-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "whatsapp_channels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "waba_id" TEXT,
    "display_name" TEXT NOT NULL DEFAULT 'WhatsApp',
    "access_token" TEXT NOT NULL,
    "auto_reply_agent_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "whatsapp_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL DEFAULT 'whatsapp',
    "contact_id" UUID,
    "customer_phone" TEXT NOT NULL,
    "customer_name" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_agent_id" UUID,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "wa_message_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channels_phone_number_id_key" ON "whatsapp_channels"("phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_channels_workspace_id_idx" ON "whatsapp_channels"("workspace_id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_status_last_message_at_idx" ON "conversations"("workspace_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_customer_phone_idx" ON "conversations"("workspace_id", "customer_phone");

-- CreateIndex
CREATE INDEX "messages_workspace_id_conversation_id_created_at_idx" ON "messages"("workspace_id", "conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for the tenant chat tables (whatsapp_channels stays control-plane / no RLS).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['conversations', 'messages'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())', t);
    EXECUTE format('CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()', t);
  END LOOP;
END $$;
