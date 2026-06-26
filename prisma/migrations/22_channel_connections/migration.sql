-- CreateTable
CREATE TABLE "channel_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "auto_reply_agent_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_connections_workspace_id_idx" ON "channel_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_provider_external_id_key" ON "channel_connections"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

