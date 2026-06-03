-- Applied to ULink prod (project cjgihassfsspxivjtgoi) via migration
-- pm_agent_widgets_display_and_checks. Part of the dashboard review-sweep fixes.

-- #10: persist the agent's presentation choice so a pinned chart widget renders
-- the same way it did in chat (chart with the table collapsed), instead of
-- silently falling back to "both".
alter table pm_agent.widgets
  add column if not exists display text not null default 'both';

-- #5 defense-in-depth: the API now validates these against the shared unions,
-- but the columns were bare text with no constraint. Lock them at the DB too.
alter table pm_agent.widgets
  add constraint widgets_display_chk check (display in ('table', 'chart', 'both'));
alter table pm_agent.widgets
  add constraint widgets_kind_chk check (kind in ('chart', 'table', 'kpi', 'text'));
alter table pm_agent.widgets
  add constraint widgets_size_chk check (size in ('sm', 'md', 'full'));
