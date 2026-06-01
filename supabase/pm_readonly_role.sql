-- Run on ULink's Supabase database (SQL Editor) to create the read-only role
-- the PM Query Agent executes queries under. This role's GRANTs are the real
-- access boundary for the agent.

CREATE ROLE pm_readonly LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

GRANT CONNECT ON DATABASE postgres TO pm_readonly;
GRANT USAGE ON SCHEMA public TO pm_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pm_readonly;

-- Belt-and-suspenders: this role can never write, even if app guards fail.
ALTER ROLE pm_readonly SET default_transaction_read_only = on;

-- RLS: every ULink public table has RLS enabled, so SELECT grants alone return
-- ZERO rows (RLS defaults to deny). On Postgres 15 the non-superuser `postgres`
-- role cannot set BYPASSRLS, so instead add a permissive SELECT-only policy for
-- pm_readonly on every public table. Re-run this loop after adding new tables,
-- or the agent will get 0 rows from them.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS pm_readonly_select ON public.%I', t.tablename);
    EXECUTE format('CREATE POLICY pm_readonly_select ON public.%I FOR SELECT TO pm_readonly USING (true)', t.tablename);
  END LOOP;
END $$;

-- To later hide sensitive tables from the agent, REVOKE SELECT and DROP the
-- policy; they disappear from both introspection and the query path. e.g.:
-- REVOKE SELECT ON public.<sensitive_table> FROM pm_readonly;
-- DROP POLICY IF EXISTS pm_readonly_select ON public.<sensitive_table>;
