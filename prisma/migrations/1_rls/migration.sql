-- Clevar tenant isolation via PostgreSQL Row-Level Security.
--
-- Every tenant-scoped table gets: RLS ENABLED + FORCED (so even the table owner
-- is subject to policies), a tenant_isolation policy keyed on the per-request
-- GUC app.workspace_id, and a BEFORE INSERT trigger that stamps workspace_id
-- from that GUC (so a client-supplied workspace_id cannot target another tenant).
-- When the GUC is unset, clevar_current_workspace() returns NULL and every
-- policy comparison fails closed → zero rows.

CREATE OR REPLACE FUNCTION clevar_current_workspace() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION clevar_set_workspace_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.workspace_id := clevar_current_workspace();
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'app.workspace_id is not set; refusing tenant write';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['companies', 'contacts', 'pipelines', 'stages', 'deals', 'notes'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = clevar_current_workspace()) WITH CHECK (workspace_id = clevar_current_workspace())',
      t
    );
    EXECUTE format(
      'CREATE TRIGGER set_workspace_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION clevar_set_workspace_id()',
      t
    );
  END LOOP;
END $$;
