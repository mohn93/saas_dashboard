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

-- To later hide sensitive tables from the agent, REVOKE here; they disappear
-- from both introspection and the query path automatically. e.g.:
-- REVOKE SELECT ON public.<sensitive_table> FROM pm_readonly;
