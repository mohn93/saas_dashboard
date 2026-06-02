-- PM-composed dashboards (shared workspace, hybrid widgets).
-- Lives in the pm_agent schema in ULink's prod DB (project ref cjgihassfsspxivjtgoi).

create table if not exists pm_agent.dashboards (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists pm_agent.widgets (
  id               uuid primary key default gen_random_uuid(),
  dashboard_id     uuid not null references pm_agent.dashboards(id) on delete cascade,
  kind             text not null,               -- 'chart' | 'table' | 'kpi' | 'text'
  title            text not null,
  position         integer not null,            -- order within the dashboard
  size             text not null default 'md',  -- 'sm' (1/3) | 'md' (1/2) | 'full'
  question         text,                         -- NL question (query widgets), for edit/provenance
  sql              text,                         -- raw generated SELECT (re-validated on refresh)
  chart_spec       jsonb,
  cached_result    jsonb,                        -- last QueryResult, capped at 100 rows
  cached_at        timestamptz,
  text_md          text,                         -- text widgets only
  created_by_email text,
  created_at       timestamptz not null default now()
);

create index if not exists widgets_dashboard_position_idx
  on pm_agent.widgets (dashboard_id, position);

-- No policies: the service-role client bypasses RLS; enabling RLS hard-blocks any access
-- through the exposed PostgREST API (anon/authenticated roles).
alter table pm_agent.dashboards enable row level security;
alter table pm_agent.widgets    enable row level security;

-- Keep dashboards.updated_at fresh on any widget insert/update/delete (atomic).
create or replace function pm_agent.bump_dashboard_updated_at()
  returns trigger language plpgsql as $$
  begin
    update pm_agent.dashboards set updated_at = now()
      where id = coalesce(new.dashboard_id, old.dashboard_id);
    return coalesce(new, old);
  end $$;

drop trigger if exists widgets_bump_dashboard_updated_at on pm_agent.widgets;
create trigger widgets_bump_dashboard_updated_at
  after insert or update or delete on pm_agent.widgets
  for each row execute function pm_agent.bump_dashboard_updated_at();

-- PostgREST must reload to expose the new tables (the pm_agent schema is already exposed).
notify pgrst, 'reload schema';
