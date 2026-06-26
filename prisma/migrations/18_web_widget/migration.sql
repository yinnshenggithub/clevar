-- CreateTable
CREATE TABLE "web_widgets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "public_key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Chat with us',
    "color" TEXT NOT NULL DEFAULT '#FF7A59',
    "welcome_message" TEXT NOT NULL DEFAULT 'Hi! How can we help?',
    "auto_reply_agent_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "web_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_widgets_public_key_key" ON "web_widgets"("public_key");

-- CreateIndex
CREATE INDEX "web_widgets_workspace_id_idx" ON "web_widgets"("workspace_id");

-- AddForeignKey
ALTER TABLE "web_widgets" ADD CONSTRAINT "web_widgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

