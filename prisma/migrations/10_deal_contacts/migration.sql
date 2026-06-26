-- CreateTable
CREATE TABLE "deal_contacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_contacts_workspace_id_contact_id_idx" ON "deal_contacts"("workspace_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_contacts_deal_id_contact_id_key" ON "deal_contacts"("deal_id", "contact_id");

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for deal_contacts.
ALTER TABLE "deal_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_contacts" USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace());
CREATE TRIGGER set_workspace_id BEFORE INSERT ON "deal_contacts" FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id();
