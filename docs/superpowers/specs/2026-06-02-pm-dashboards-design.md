# PM-Composed Dashboards — Design

**Date:** 2026-06-02
**Status:** Approved (design); pending implementation plan
**Project:** `flywheel_saas_dashboard` (Flywheel Command Center) — PM Data Agent

## Problem

The PM Data Agent answers questions in chat: it produces a chart spec, SQL, and a
result table per turn. Those answers are ephemeral — they live in a conversation and
can't be assembled into a standing view. PMs want to **compose dashboards** out of agent
results: ask a question, get an answer, and pin it as a widget on a dashboard that stays
current over time. Two surfaces should feed this: the existing chat (pin an answer) and
the dashboard itself (compose in place with the agent's help).

## Decisions (locked during brainstorming)

- **Widget data model — Hybrid.** A query-backed widget stores the resolved SQL + chart
  spec **and** a cached last result. It renders the cache instantly and refreshes to stay
  current. (Not a frozen snapshot; not a re-run-from-scratch live query with no cache.)
- **Ownership — Fully shared.** Consistent with the chat workspace: every signed-in PM
  sees all dashboards and may create, edit, rearrange, and delete any of them. No
  per-user privacy, no owner checks on mutations. Deletes are unguarded and irreversible.
- **Layout — Responsive grid with per-widget size.** Widgets are Small (⅓), Medium (½),
  or Full width on a 12-column grid; they flow into rows and reorder by drag. **Collapses
  to a single column on mobile** (all widgets full width below the `md` breakpoint).
- **Widget kinds — chart, data table, KPI (single number), text/markdown note.**
- **Creation — Both paths, one engine.** Pin from chat *and* add-in-place on the
  dashboard, both reusing the existing streaming agent for creation and funneling to one
  `createWidget` operation.
- **Refresh — Auto if stale (~5 min) + manual.** Show cache instantly; silently re-run
  widgets whose cache is older than `STALE_MS`; plus "Refresh all" and per-widget refresh.
- **Storage home — ULink prod DB, `pm_agent` schema**, via the service-role REST client
  (`getULinkClient().schema("pm_agent")`), same pattern as `conversations.ts`/`memory.ts`.
- **Drag-reorder dependency — `@dnd-kit/sortable`** (the one new dependency).

## The key principle: create with the LLM, refresh without it

- **Creating** a widget runs the full agent loop (`runAgent`): the LLM writes SQL and
  picks a chart while the PM iterates and judges the answer.
- Once saved, the widget stores the **resolved** SQL + chart spec + cached result.
  **Refresh re-runs the stored SQL directly** through the read-only execute path
  (`validateSelect` → `execute`) — **never** the LLM.

Re-invoking the LLM on refresh would be slow, costly, and non-deterministic: it could
silently produce *different* SQL than the PM approved — a dashboard that rewrites its own
definition. The LLM defines a widget once; after that it is a saved query. This also keeps
reuse clean: `runAgent`/streaming for creation, `validate.ts` + the read-only pg client for
refresh, `ResultView`/`Chart` for rendering.

## Architecture

A new top-level **Dashboards** surface sits alongside the PM Agent chat. A dashboard is an
ordered set of **widgets**. A widget is either a query-backed visual (chart / table / KPI)
holding `sql` + `chart_spec` + a cached result, or a text note holding markdown. Creation
flows from two surfaces into a single `createWidget` operation; refresh runs stored SQL
through the existing read-only execution path with no LLM involvement.

### 1. Data model (`pm_agent` schema, ULink DB)

Same conventions as `conversations`/`messages`: service-role client, RLS enabled with no
policies, recorded in `supabase/`, `updated_at` bumped by trigger.

```sql
create table pm_agent.dashboards (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table pm_agent.widgets (
  id               uuid primary key default gen_random_uuid(),
  dashboard_id     uuid not null references pm_agent.dashboards(id) on delete cascade,
  kind             text not null,               -- 'chart' | 'table' | 'kpi' | 'text'
  title            text not null,
  position         integer not null,            -- order within the dashboard
  size             text not null default 'md',  -- 'sm' (1/3) | 'md' (1/2) | 'full'
  -- query-backed widgets (null for text):
  question         text,                        -- NL question, for "edit query" / provenance
  sql              text,
  chart_spec       jsonb,
  cached_result    jsonb,                        -- last QueryResult, capped at 100 rows
  cached_at        timestamptz,
  -- text widgets (null otherwise):
  text_md          text,
  created_by_email text,
  created_at       timestamptz not null default now()
);
create index widgets_dashboard_position_idx on pm_agent.widgets (dashboard_id, position);

alter table pm_agent.dashboards enable row level security;
alter table pm_agent.widgets    enable row level security;
-- No policies: the service-role client bypasses RLS; this hard-blocks any access through
-- the exposed PostgREST API (anon/authenticated roles).

-- Bump dashboards.updated_at whenever a widget is inserted/updated/deleted (atomic).
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

notify pgrst, 'reload schema';
```

- One table for all widget kinds; `kind` discriminates which columns are populated.
  `cached_result` + `cached_at` are the hybrid cache. JSONB means no schema churn as the
  result/chart shapes evolve.
- `kpi` is a query-backed widget rendered as a big number; it is **auto-suggested** when
  the result is 1 row × 1 numeric column, and the PM can override the render kind.
- `size` maps to a 12-col grid: sm=4, md=6, full=12; all collapse to full width below `md`.
- The migration is provisioned directly against the ULink prod DB (it lives in `pm_agent`,
  maintained from this dashboard project, not in ULink's own migrations) and saved to
  `supabase/pm_agent_dashboards.sql` for the record.

### 2. Types

Add to `src/lib/integrations/ulink-agent/types.ts`:

```ts
export type WidgetKind = "chart" | "table" | "kpi" | "text";
export type WidgetSize = "sm" | "md" | "full";

export interface Widget {
  id: string;
  dashboardId: string;
  kind: WidgetKind;
  title: string;
  position: number;
  size: WidgetSize;
  question: string | null;
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;   // from cached_result
  cachedAt: string | null;
  textMd: string | null;
  createdByEmail: string | null;
}

export interface DashboardSummary {
  id: string;
  name: string;
  widgetCount: number;
  createdByEmail: string | null;
  updatedAt: string;
}
```

### 3. Pure logic module

**New** `src/lib/integrations/ulink-agent/widgets.ts` (no `"use client"`), pure functions
shared by client and server and unit-tested:

- `deriveWidgetKind(result: QueryResult | null): WidgetKind` — `null` → `"table"`;
  1 row × 1 column whose value is numeric → `"kpi"`; if a usable `chart` is present →
  `"chart"`; else `"table"`. (Callers may still override.)
- `isStale(cachedAt: string | null, now: number, staleMs = STALE_MS): boolean` — `true`
  when `cachedAt` is null or older than `staleMs`. `STALE_MS = 5 * 60_000`.
- `sizeToCols(size: WidgetSize): number` — `sm → 4`, `md → 6`, `full → 12`.
- `applyReorder(ids: string[]): Record<string, number>` — array order → `{id: position}`.
- `widgetFromAnswer(input): WidgetCreateInput` — turns a chat `AgentMessage`/answer or an
  in-place stream result into the create payload (`kind`, `title`, `size`, `question`,
  `sql`, `chart`, `result`). `title` defaults to `deriveTitle(question)` (reuse the helper
  from `conversations.ts`); `size` defaults to `"md"`; `kind` defaults to
  `deriveWidgetKind(result)`.

`WidgetCreateInput` and `WidgetPatch` types live in `widgets.ts` (alongside the store
interface below) to keep `types.ts` free of store concerns, mirroring how
`ConversationStore` lives in `conversations.ts`.

### 4. Dashboard store

**New** `src/lib/integrations/ulink-agent/dashboards.ts` exporting `dashboardStore`, using
`getULinkClient().schema("pm_agent")` exactly like `conversations.ts`:

- `listDashboards(): Promise<DashboardSummary[]>` — ordered by `updated_at desc`, limit
  100; `widgetCount` via a count per dashboard (a `widgets` count aggregate or a grouped
  query).
- `createDashboard({ name, userEmail }): Promise<{ id: string }>`.
- `getDashboard(id): Promise<{ dashboard: DashboardSummary; widgets: Widget[] }>` — widgets
  ordered by `position asc`; each row mapped to `Widget` (JSONB columns rehydrated).
- `renameDashboard(id, name): Promise<void>`.
- `deleteDashboard(id): Promise<void>` — cascade delete.
- `createWidget(dashboardId, input: WidgetCreateInput): Promise<{ id: string }>` —
  `position` defaults to current max+1; sets `cached_at = now()` when a `result` is present.
- `updateWidget(id, patch: WidgetPatch): Promise<void>` — any of
  title/size/kind/chart/text_md/position; for "edit query" also sql/question/cached_result.
- `deleteWidget(id): Promise<void>`.
- `reorderWidgets(dashboardId, positions: Record<string, number>): Promise<void>` — bulk
  position update after a drag settles.
- `refreshWidget(id): Promise<QueryResult>` — loads stored `sql`, runs `validateSelect` →
  the read-only `execute`, writes back `cached_result` + `cached_at`, returns the result.
  **No LLM.** Throws on validation/execution failure (caller keeps last good cache).

`refreshWidget` reuses the same read-only execution function the query route already wires
up (the `execute` dep built from `ULINK_READONLY_DATABASE_URL`); extract that wiring into a
shared helper if it currently lives inline in the route so both paths share it.

### 5. API endpoints

All require a valid Firebase session via `getSessionEmail` (`src/lib/auth/session.ts`);
return `401` when absent. Shared pool — no per-user filtering, no owner checks on mutation.

```
GET    /api/agent/dashboards                 → { dashboards: DashboardSummary[] }
POST   /api/agent/dashboards                 → { name } → { id }
GET    /api/agent/dashboards/[id]            → { dashboard, widgets } ; 404 if missing
PATCH  /api/agent/dashboards/[id]            → { name } rename
DELETE /api/agent/dashboards/[id]            → { ok: true } cascade delete
POST   /api/agent/dashboards/[id]/widgets    → WidgetCreateInput → { id }
PATCH  /api/agent/dashboards/[id]/reorder    → { positions } bulk reorder after drag
PATCH  /api/agent/widgets/[id]               → WidgetPatch (title/size/kind/chart/text/query)
DELETE /api/agent/widgets/[id]               → { ok: true }
POST   /api/agent/widgets/[id]/refresh       → { result: QueryResult } ; 502 on store error
```

Next 14 sync route params (`{ params: { id: string } }`), matching the existing
conversation routes. Store errors → `502`; missing dashboard on GET → `404`.

### 6. Creation flows (both → one `createWidget`)

**Pin from chat (Path A).** Each finished chat answer with a `result` gets an **"Add to
dashboard ▾"** control beside the existing 👍/👎 in `agent-message.tsx`. It opens a
`PinToDashboard` popover: choose a dashboard or "＋ New dashboard…" (inline name field),
confirm/edit the title (defaults to the question), pick size, pick render kind
(pre-selected via `deriveWidgetKind`). Confirm → `POST /dashboards/[id]/widgets` with the
message's `sql`, `chart`, `result`, `question`. A success toast links to the dashboard.

**Add in place (Path B).** On a dashboard, a dashed **"＋ Add widget"** tile at the end of
the grid opens an inline composer. It *is* the agent: the PM types a question, it streams
through the existing `/api/agent/query` (thinking panel + result preview, reusing
`useAgentStream` + `AgentMessage`/`ResultView`). On **"Add to dashboard"** in the preview →
same `createWidget` with the freshly-streamed `sql`/`chart`/`result`/`question`. The
composer can also add a **text note** widget directly (no agent call): a title + markdown
body. Adding-in-place does not create a persisted conversation (the stream is used purely
to compose).

Both paths produce the same `widgets` row.

### 7. Rendering & layout (client)

- **Sidebar:** add a **Dashboards** nav item (`/dashboards`) in `src/components/layout/sidebar.tsx`.
- **Dashboards list page** `src/app/(dashboard)/dashboards/page.tsx`: a "＋ New dashboard"
  button and a grid of cards (name, widget count, relative `updatedAt`, faint creator).
  Per-card delete with `stopPropagation` (shared, unguarded, like chats). Empty state.
- **Dashboard page** `src/app/(dashboard)/dashboards/[id]/page.tsx`: header with editable
  name, "Refresh all", and an **Edit / Done** toggle; then the **responsive 12-col grid**
  (`sizeToCols`; one column below `md`). Components:
  - `DashboardGrid` — lays out widgets; wraps them in `@dnd-kit/sortable` (drag only in
    edit mode); on drop, computes `applyReorder` and calls the reorder endpoint.
  - `DashboardWidget` — the card chrome: title, freshness line ("updated 4m ago" / "📷
    cached" / "couldn't refresh — showing cached"), ↻ refresh button; in edit mode also a
    drag handle, size toggle (S/M/Full), render-kind toggle (chart/table/KPI), chart-type
    toggle (bar/line/area), "Edit query", and remove.
  - Body renders by `kind`: `chart`/`table` reuse `Chart`/the table from `ResultView`; a
    new compact **KPI** render (big number from the single cell); `text` via a small
    markdown renderer.
- **Hooks:** `use-dashboards.ts` (`useDashboards()` → `{ dashboards, refresh, create,
  remove }`, optimistic delete reconciling on failure — same shape as
  `use-conversation-list.ts`) and `use-dashboard.ts` (`useDashboard(id)` → load,
  per-widget `refresh`, `refreshAll`, `addWidget`, `updateWidget`, `removeWidget`,
  `reorder`, `rename`).

### 8. Refresh (hybrid, auto-if-stale)

- `STALE_MS = 5 * 60_000`. On dashboard open, render every widget from `cached_result`
  instantly (no spinner). For each query widget where `isStale(cachedAt, now)`, fire a
  background `POST /widgets/[id]/refresh`; on success, swap in the fresh result and show a
  subtle "updated just now".
- "Refresh all" fans out per-widget refresh (concurrently); per-widget ↻ refreshes one.
- A widget whose stored SQL now errors (schema drift) keeps its last good cache and shows a
  quiet "couldn't refresh — showing cached" chip; it never blanks.

## Error handling

- **Refresh failures never blank a widget** — the endpoint throws, the client keeps the
  cached result and shows an error chip.
- **Create failures** surface a toast; a widget is a single insert, so nothing half-saves.
- **Delete of the dashboard you're viewing** routes back to `/dashboards`.
- **Pinning to a dashboard deleted mid-session** → the create FK/`404`s; the toast reports
  failure and the chat answer is untouched.
- **List/get/mutate** use standard JSON errors: `401` without a session, `404` for a
  missing dashboard on GET, `502` on store errors.

## Testing (Vitest, matching existing patterns)

Pure logic only (store glue, routes, and hooks stay untested — same convention as
`conversations.ts`):

- `deriveWidgetKind`: null → table; 1×1 numeric → kpi; chart present → chart; else table.
- `isStale`: null cachedAt → true; older than `STALE_MS` → true; recent → false.
- `sizeToCols`: sm/md/full → 4/6/12.
- `applyReorder`: array order → correct `{id: position}` map.
- `widgetFromAnswer`: builds the expected `WidgetCreateInput` (title default, kind default,
  size default, carries sql/chart/result/question; text-note shape carries `text_md` and
  null query fields).

## Out of scope (YAGNI)

- Scheduled / cron refresh (only on-open-if-stale + manual).
- Freeform drag-resize canvas (grid with S/M/Full sizes only).
- Per-user privacy, ownership checks, or dashboard sharing links / export.
- Cross-filtering or interactions between widgets.
- Comments / annotations beyond the text-note widget.
- Manual rename of pinned widgets beyond the title field (no full query editor UI — "edit
  query" reuses the inline agent composer).

## Files

- **New:** `src/lib/integrations/ulink-agent/widgets.ts` (pure logic + create/patch types)
- **New:** `src/lib/integrations/ulink-agent/dashboards.ts` (`dashboardStore`)
- **New:** `src/hooks/use-dashboards.ts`
- **New:** `src/hooks/use-dashboard.ts`
- **New:** `src/app/(dashboard)/dashboards/page.tsx` (list)
- **New:** `src/app/(dashboard)/dashboards/[id]/page.tsx` (one dashboard)
- **New:** `src/components/dashboard-builder/dashboard-grid.tsx`
- **New:** `src/components/dashboard-builder/dashboard-widget.tsx`
- **New:** `src/components/dashboard-builder/add-widget-composer.tsx`
- **New:** `src/components/dashboard-builder/kpi-widget.tsx`
- **New:** `src/components/agent/pin-to-dashboard.tsx`
- **New:** `supabase/pm_agent_dashboards.sql`
- **Modify:** `src/lib/integrations/ulink-agent/types.ts` (add `Widget`, `DashboardSummary`,
  `WidgetKind`, `WidgetSize`)
- **Modify:** `src/app/api/agent/query/route.ts` (extract the read-only `execute` wiring
  into a shared helper for `refreshWidget` to reuse)
- **Modify:** `src/components/agent/agent-message.tsx` (add the "Add to dashboard" control)
- **Modify:** `src/components/layout/sidebar.tsx` (add the Dashboards nav item)
- **Modify:** `package.json` (add `@dnd-kit/core` + `@dnd-kit/sortable`)
- **New route handlers:** `src/app/api/agent/dashboards/route.ts`,
  `dashboards/[id]/route.ts`, `dashboards/[id]/widgets/route.ts`,
  `dashboards/[id]/reorder/route.ts`, `widgets/[id]/route.ts`,
  `widgets/[id]/refresh/route.ts`
