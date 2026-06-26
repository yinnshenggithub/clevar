-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorites_workspace_id_user_id_idx" ON "favorites"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_workspace_id_user_id_entity_type_entity_id_key" ON "favorites"("workspace_id", "user_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for favorites (tenant plane).
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "favorites" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "favorites" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
