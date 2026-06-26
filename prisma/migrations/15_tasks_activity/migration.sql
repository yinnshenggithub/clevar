-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "due_at" TIMESTAMPTZ,
    "assignee_id" UUID,
    "parent_type" "ObjectType",
    "parent_id" UUID,
    "created_by_id" UUID,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "parent_type" "ObjectType" NOT NULL,
    "parent_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_workspace_id_status_due_at_idx" ON "tasks"("workspace_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_assignee_id_status_idx" ON "tasks"("workspace_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_parent_type_parent_id_idx" ON "tasks"("workspace_id", "parent_type", "parent_id");

-- CreateIndex
CREATE INDEX "activity_events_workspace_id_parent_type_parent_id_created__idx" ON "activity_events"("workspace_id", "parent_type", "parent_id", "created_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for tasks + activity_events (tenant plane).
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "tasks" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();

ALTER TABLE "activity_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_events" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "activity_events" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
