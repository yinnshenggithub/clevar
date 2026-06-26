-- CreateTable
CREATE TABLE "canned_responses" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "shortcode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canned_responses_workspace_id_shortcode_key" ON "canned_responses"("workspace_id", "shortcode");

-- CreateIndex
CREATE INDEX "macros_workspace_id_idx" ON "macros"("workspace_id");

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for canned_responses + macros (tenant plane).
ALTER TABLE "canned_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canned_responses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "canned_responses" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "canned_responses" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();

ALTER TABLE "macros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "macros" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "macros" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "macros" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
