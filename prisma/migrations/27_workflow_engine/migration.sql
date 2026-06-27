-- Workflow engine v2: durable runs + per-workspace custom values, plus the
-- contact columns the GoHighLevel-style catalog needs to be REAL (tags, owner,
-- DND, engagement score) rather than dropdown-only.

-- ─── Contact: tags / owner / DND / engagement score ───────────────────────────
ALTER TABLE "contacts" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "contacts" ADD COLUMN "owner_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "dnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contacts" ADD COLUMN "engagement_score" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "contacts_tags_idx" ON "contacts" USING GIN ("tags");
CREATE INDEX "contacts_workspace_id_owner_id_idx" ON "contacts" ("workspace_id", "owner_id");

-- ─── workflow_runs: durable execution state (waits, drips, retries) ────────────
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | WAITING | DONE | FAILED | CANCELLED
    "pc" INTEGER NOT NULL DEFAULT 0,          -- program counter into the compiled step list
    "context" JSONB NOT NULL DEFAULT '{}',    -- serialized WorkflowContext + accumulated vars
    "resume_at" TIMESTAMPTZ,                  -- when a WAITING run becomes due
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_runs_workspace_id_status_resume_at_idx" ON "workflow_runs" ("workspace_id", "status", "resume_at");
CREATE INDEX "workflow_runs_workflow_id_idx" ON "workflow_runs" ("workflow_id");

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── workspace_custom_values: named workspace-level merge variables ────────────
CREATE TABLE "workspace_custom_values" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_custom_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_custom_values_workspace_id_key_key" ON "workspace_custom_values" ("workspace_id", "key");

ALTER TABLE "workspace_custom_values" ADD CONSTRAINT "workspace_custom_values_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS (tenant plane) ───────────────────────────────────────────────────────
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_runs" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "workflow_runs" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();

ALTER TABLE "workspace_custom_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_custom_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workspace_custom_values" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "workspace_custom_values" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
