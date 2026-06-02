-- Record of the public.users_view changes that let the PM Data Agent read user
-- identity (email, name, company) safely. Applied to ULink prod (project ref
-- cjgihassfsspxivjtgoi) on 2026-06-02 via MCP; recorded here for the record.
-- Idempotent — safe to re-run.
--
-- Background:
--   * users_view is the ONLY readable projection of auth.users for the read-only
--     analytics role (pm_readonly). auth.users itself is not accessible to it.
--   * It was originally `security_invoker=true`, which runs the view with the
--     CALLER's privileges -> pm_readonly hit "permission denied for table users".
--     Flipping to owner-rights (security_invoker=false) makes it run as the owner
--     (postgres), so pm_readonly only needs its existing SELECT on the view and
--     gets ZERO direct access to the auth schema. Only pm_readonly / postgres /
--     service_role can SELECT this view (NOT anon/authenticated), so this exposes
--     nothing new to client-facing roles.
--   * name/company are derived from auth.users.raw_user_meta_data; only those
--     fields are surfaced (never tokens or the rest of the metadata blob).

create or replace view public.users_view with (security_invoker = false) as
select
  u.id,
  u.created_at,
  u.email,
  -- display name: OAuth signups use full_name/name; the custom signup form uses fullName
  coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(u.raw_user_meta_data->>'fullName', '')
  ) as name,
  -- company entered at signup (custom form); weaker identifier, ~89/323 users
  nullif(u.raw_user_meta_data->>'companyName', '') as company
from auth.users u;

grant select on public.users_view to pm_readonly;

-- ===== PM agent catalog (pm_agent schema) so the planner can find + use the view =====

insert into pm_agent.table_catalog (table_name, description, updated_at) values (
  'users_view',
  'Readable view of platform users — one row per authenticated user — exposing id (= auth.users.id = profiles.id), email, created_at (signup time), name (display name from signup/OAuth metadata; NULL when none on record), and company (companyName from signup; NULL for most). Canonical source for user email/name in the accessible schema (auth.users itself is not accessible). For a best-effort label use coalesce(name, company, email). Join to profiles on id for marketing attribution.',
  now()
)
on conflict (table_name) do update set description = excluded.description, updated_at = now();

insert into pm_agent.column_catalog (table_name, column_name, data_type, is_nullable, description) values
  ('users_view','id','uuid', false, 'Primary key; equals auth.users.id and profiles.id. Join key to profiles/projects/links.'),
  ('users_view','created_at','timestamp with time zone', false, 'User signup / account creation time.'),
  ('users_view','email','character varying', true, 'User email address. The only readable source of user email in the schema.'),
  ('users_view','name','text', true, 'User display name, derived from auth signup/OAuth metadata (full_name / name / fullName). NULL for users with no name on record (e.g. plain email signups).'),
  ('users_view','company','text', true, 'Company name the user entered at signup (raw_user_meta_data.companyName). NULL for most users (~89 of 323 have it). A weaker identifier than name; use as a fallback label.')
on conflict (table_name, column_name) do update
  set data_type = excluded.data_type, is_nullable = excluded.is_nullable, description = excluded.description;

-- Trusted examples (examples has no unique constraint on question; guard with NOT EXISTS).
insert into pm_agent.examples (question, sql)
select 'List the 10 most recent users with their emails',
       'select id, email, created_at from users_view order by created_at desc limit 10'
where not exists (select 1 from pm_agent.examples
  where question = 'List the 10 most recent users with their emails');

insert into pm_agent.examples (question, sql)
select 'List the 10 most recent users with their names and emails',
       'select name, email, created_at from users_view order by created_at desc limit 10'
where not exists (select 1 from pm_agent.examples
  where question = 'List the 10 most recent users with their names and emails');
