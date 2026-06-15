-- ULink Agent performance guardrails.
-- 1) Shadow-mode logging: record the EXPLAIN estimate for every query.
alter table pm_agent.query_log
  add column if not exists est_cost double precision,
  add column if not exists est_rows double precision;

-- 2) DB-level resource limits on the agent's read-only role (belt-and-suspenders;
--    the app also sets these per-connection). Adjust work_mem to taste.
--    Guarded so the migration doesn't half-apply if pm_readonly isn't created yet.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pm_readonly') then
    alter role pm_readonly set statement_timeout = '8s';
    alter role pm_readonly set work_mem = '32MB';
  end if;
end $$;
