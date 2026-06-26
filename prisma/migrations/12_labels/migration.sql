-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_labels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labels_workspace_id_name_key" ON "labels"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "conversation_labels_workspace_id_label_id_idx" ON "conversation_labels"("workspace_id", "label_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_labels_conversation_id_label_id_key" ON "conversation_labels"("conversation_id", "label_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for labels + conversation_labels (tenant plane).
ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "labels" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "labels" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();

ALTER TABLE "conversation_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_labels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_labels" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "conversation_labels" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
