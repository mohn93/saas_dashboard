# PM-Composed Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PMs compose shared dashboards from PM Data Agent results — pin a chat answer or build in place with the agent — where each widget stores its query + a cached result and refreshes without re-invoking the LLM.

**Architecture:** A new `/dashboards` surface alongside the agent chat. A dashboard owns an ordered set of widgets (chart/table/KPI/text). Query widgets store the resolved SQL + chart spec + a cached `QueryResult`; refresh re-runs the stored SQL through the existing read-only execute path (`validateSelect` → `executeReadOnly`) with **no LLM**. Storage lives in the `pm_agent` schema of ULink's prod DB via the service-role client, mirroring `conversations.ts`. Layout is a responsive 12-col grid (sm=4/md=6/full=12, collapsing to one column on mobile) with `@dnd-kit` drag-reorder.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase service-role REST client (`pm_agent` schema), `pg` read-only pool, `@tremor/react` charts, Radix popover/select, `@dnd-kit/sortable`, Vitest.

---

## Conventions for this plan (read first)

- **Branch:** Work on `feat/pm-dashboards` (never commit feature work to `main`). The first task creates it.
- **Test command:** `npx vitest run` (the repo script is `vitest run`). Run a single file with `npx vitest run path/to/file.test.ts`.
- **Build/lint gate:** `npm run build` (Next build, includes typecheck + lint).
- **Testing scope (matches the existing `ulink-agent` code):** Only **pure logic** gets unit tests (see `conversations.test.ts`, which tests `deriveTitle`/`persistTurn` but not the supabase store glue). **Store modules, route handlers, hooks, and React components are intentionally NOT unit-tested** — verify them with `npm run build` + keeping `npx vitest run` green + the manual smoke steps in each task. Do not add a test runner for React/DOM.
- **Never `git add -A`** — a stray `._fix2.cjs` lives in the repo root and must never be staged. Always `git add` exact paths.
- **Service-role client:** `getULinkClient().schema("pm_agent")` (see `conversations.ts`). It bypasses RLS.
- **Auth in routes:** `getSessionEmail(request)` from `@/lib/auth/session`; return `401` when null. Shared workspace — no owner checks.

---

## Task 1: Branch + database migration (`pm_agent` schema, ULink prod DB)

**Files:**
- Create: `supabase/pm_agent_dashboards.sql`

This task creates the branch, writes the migration file for the record, and applies the DDL to the ULink prod DB. **The controller applies the DDL via the Supabase MCP `apply_migration`/`execute_sql` tools** (the implementer subagent does not have prod DB write access — if you are a subagent, write the file and STOP, reporting that the controller must apply it).

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
git checkout main && git checkout -b feat/pm-dashboards
```

- [ ] **Step 2: Write the migration file**

Create `supabase/pm_agent_dashboards.sql`:

```sql
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
```

- [ ] **Step 3: Apply to prod (controller, via Supabase MCP)**

Apply the SQL above with `mcp__supabase__apply_migration` (name: `pm_agent_dashboards`). Confirm the supabase MCP targets ULink (`current_database = postgres`, project ref `cjgihassfsspxivjtgoi`) before applying.

- [ ] **Step 4: Verify on prod**

Run via `mcp__supabase__execute_sql`:

```sql
insert into pm_agent.dashboards (name, created_by_email) values ('smoke', 'test@x.com') returning id;
-- capture <id>, then:
insert into pm_agent.widgets (dashboard_id, kind, title, position, size, text_md)
  values ('<id>', 'text', 'hi', 0, 'full', 'note') returning id;
select updated_at > created_at as bumped from pm_agent.dashboards where id = '<id>';
delete from pm_agent.dashboards where id = '<id>';  -- cascade removes the widget
select count(*) from pm_agent.widgets where dashboard_id = '<id>';  -- expect 0
```

Expected: insert succeeds, `bumped = true` (trigger fired), cascade delete leaves 0 widgets.

- [ ] **Step 5: Commit**

```bash
git add supabase/pm_agent_dashboards.sql
git commit -m "feat(dashboards): pm_agent dashboards + widgets schema"
```

---

## Task 2: Types + pure widget logic

**Files:**
- Modify: `src/lib/integrations/ulink-agent/types.ts` (append new types)
- Create: `src/lib/integrations/ulink-agent/widgets.ts`
- Test: `src/lib/integrations/ulink-agent/widgets.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

Append to the end of `src/lib/integrations/ulink-agent/types.ts`:

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
  result: QueryResult | null; // from cached_result
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

- [ ] **Step 2: Write the failing test**

Create `src/lib/integrations/ulink-agent/widgets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  STALE_MS,
  deriveWidgetKind,
  isStale,
  sizeToCols,
  applyReorder,
  capRows,
  widgetFromAnswer,
} from "./widgets";
import type { QueryResult } from "./types";

const oneByOne: QueryResult = { columns: ["mau"], rows: [{ mau: 51884 }], rowCount: 1 };
const multi: QueryResult = {
  columns: ["day", "n"],
  rows: [{ day: "2026-06-01", n: 5 }, { day: "2026-06-02", n: 8 }],
  rowCount: 2,
};

describe("deriveWidgetKind", () => {
  it("returns table for a null result", () => {
    expect(deriveWidgetKind(null, null)).toBe("table");
  });
  it("returns kpi for a single numeric cell", () => {
    expect(deriveWidgetKind(oneByOne, null)).toBe("kpi");
  });
  it("returns chart when a usable chart spec is present", () => {
    expect(
      deriveWidgetKind(multi, { type: "line", xColumn: "day", yColumn: "n" })
    ).toBe("chart");
  });
  it("returns table for multi-column data with no chart", () => {
    expect(deriveWidgetKind(multi, { type: "none", xColumn: null, yColumn: null })).toBe("table");
  });
});

describe("isStale", () => {
  const now = 1_000_000_000_000;
  it("is stale when cachedAt is null", () => {
    expect(isStale(null, now)).toBe(true);
  });
  it("is stale when older than STALE_MS", () => {
    expect(isStale(new Date(now - STALE_MS - 1).toISOString(), now)).toBe(true);
  });
  it("is fresh when within STALE_MS", () => {
    expect(isStale(new Date(now - 1000).toISOString(), now)).toBe(false);
  });
});

describe("sizeToCols", () => {
  it("maps sizes to column spans", () => {
    expect(sizeToCols("sm")).toBe(4);
    expect(sizeToCols("md")).toBe(6);
    expect(sizeToCols("full")).toBe(12);
  });
});

describe("applyReorder", () => {
  it("maps array order to positions", () => {
    expect(applyReorder(["c", "a", "b"])).toEqual({ c: 0, a: 1, b: 2 });
  });
});

describe("capRows", () => {
  it("returns null for null", () => {
    expect(capRows(null, 100)).toBeNull();
  });
  it("caps rows but preserves the true rowCount", () => {
    const big: QueryResult = {
      columns: ["x"],
      rows: Array.from({ length: 250 }, (_, i) => ({ x: i })),
      rowCount: 250,
    };
    const out = capRows(big, 100)!;
    expect(out.rows).toHaveLength(100);
    expect(out.rowCount).toBe(250);
  });
});

describe("widgetFromAnswer", () => {
  it("builds a query widget with derived kind and title", () => {
    const w = widgetFromAnswer({
      question: "production MAU",
      sql: "select count(*) ...",
      chart: null,
      result: oneByOne,
    });
    expect(w.kind).toBe("kpi");
    expect(w.title).toBe("production MAU");
    expect(w.size).toBe("md");
    expect(w.sql).toBe("select count(*) ...");
    expect(w.result).toEqual(oneByOne);
    expect(w.textMd).toBeNull();
  });
  it("honors explicit overrides", () => {
    const w = widgetFromAnswer({
      question: "signups by day",
      sql: "select ...",
      chart: { type: "bar", xColumn: "day", yColumn: "n" },
      result: multi,
      title: "Signups",
      size: "full",
      kind: "table",
    });
    expect(w.title).toBe("Signups");
    expect(w.size).toBe("full");
    expect(w.kind).toBe("table");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/widgets.test.ts`
Expected: FAIL — `Cannot find module './widgets'`.

- [ ] **Step 4: Implement `widgets.ts`**

Create `src/lib/integrations/ulink-agent/widgets.ts`:

```ts
import { deriveTitle } from "./conversations";
import type { ChartSpec, QueryResult, WidgetKind, WidgetSize } from "./types";

export const STALE_MS = 5 * 60_000; // auto-refresh widgets whose cache is older than 5 min
export const MAX_CACHED_ROWS = 100; // cap rows stored in cached_result (chart/table need few)

export interface WidgetCreateInput {
  kind: WidgetKind;
  title: string;
  size: WidgetSize;
  question: string | null;
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  textMd: string | null;
}

export interface WidgetPatch {
  title?: string;
  size?: WidgetSize;
  kind?: WidgetKind;
  chart?: ChartSpec | null;
  textMd?: string | null;
  position?: number;
  // "edit query" replaces the underlying query + resets the cache:
  question?: string | null;
  sql?: string | null;
  result?: QueryResult | null;
}

function isNumericCell(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

export function deriveWidgetKind(
  result: QueryResult | null,
  chart: ChartSpec | null
): WidgetKind {
  if (!result) return "table";
  if (
    result.rows.length === 1 &&
    result.columns.length === 1 &&
    isNumericCell(result.rows[0][result.columns[0]])
  ) {
    return "kpi";
  }
  if (chart && chart.type !== "none" && chart.xColumn && chart.yColumn) return "chart";
  return "table";
}

export function isStale(cachedAt: string | null, now: number, staleMs = STALE_MS): boolean {
  if (!cachedAt) return true;
  const t = Date.parse(cachedAt);
  if (Number.isNaN(t)) return true;
  return now - t > staleMs;
}

export function sizeToCols(size: WidgetSize): number {
  return size === "sm" ? 4 : size === "full" ? 12 : 6;
}

export function applyReorder(ids: string[]): Record<string, number> {
  return ids.reduce<Record<string, number>>((acc, id, i) => {
    acc[id] = i;
    return acc;
  }, {});
}

export function capRows(result: QueryResult | null, max = MAX_CACHED_ROWS): QueryResult | null {
  if (!result) return null;
  if (result.rows.length <= max) return result;
  return { ...result, rows: result.rows.slice(0, max) }; // rowCount stays the true count
}

export function widgetFromAnswer(input: {
  question: string;
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  title?: string;
  size?: WidgetSize;
  kind?: WidgetKind;
}): WidgetCreateInput {
  return {
    kind: input.kind ?? deriveWidgetKind(input.result, input.chart),
    title: input.title?.trim() || deriveTitle(input.question),
    size: input.size ?? "md",
    question: input.question,
    sql: input.sql,
    chart: input.chart,
    result: capRows(input.result),
    textMd: null,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/integrations/ulink-agent/widgets.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/ulink-agent/types.ts src/lib/integrations/ulink-agent/widgets.ts src/lib/integrations/ulink-agent/widgets.test.ts
git commit -m "feat(dashboards): widget types + pure logic (kind/stale/size/reorder/cap)"
```

---

## Task 3: Dashboard store

**Files:**
- Create: `src/lib/integrations/ulink-agent/dashboards.ts`

No unit test (supabase glue, per project convention — same as `conversations.ts`). Verify with `npm run build`.

- [ ] **Step 1: Implement the store**

Create `src/lib/integrations/ulink-agent/dashboards.ts`:

```ts
import { getULinkClient } from "@/lib/integrations/ulink/client";
import { executeReadOnly } from "./client";
import { validateSelect } from "./validate";
import { capRows } from "./widgets";
import type { WidgetCreateInput, WidgetPatch } from "./widgets";
import type {
  ChartSpec,
  DashboardSummary,
  QueryResult,
  Widget,
} from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

export interface DashboardStore {
  listDashboards(): Promise<DashboardSummary[]>;
  createDashboard(input: { name: string; userEmail: string | null }): Promise<{ id: string }>;
  getDashboard(id: string): Promise<{ dashboard: DashboardSummary; widgets: Widget[] }>;
  renameDashboard(id: string, name: string): Promise<void>;
  deleteDashboard(id: string): Promise<void>;
  createWidget(dashboardId: string, input: WidgetCreateInput): Promise<{ id: string }>;
  updateWidget(id: string, patch: WidgetPatch): Promise<void>;
  deleteWidget(id: string): Promise<void>;
  reorderWidgets(positions: Record<string, number>): Promise<void>;
  refreshWidget(id: string): Promise<QueryResult>;
}

function toDashboardSummary(r: Record<string, unknown>): DashboardSummary {
  const widgetsAgg = r.widgets as { count: number }[] | undefined;
  return {
    id: r.id as string,
    name: r.name as string,
    widgetCount: widgetsAgg?.[0]?.count ?? 0,
    createdByEmail: (r.created_by_email as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

function toWidget(r: Record<string, unknown>): Widget {
  return {
    id: r.id as string,
    dashboardId: r.dashboard_id as string,
    kind: r.kind as Widget["kind"],
    title: r.title as string,
    position: r.position as number,
    size: r.size as Widget["size"],
    question: (r.question as string | null) ?? null,
    sql: (r.sql as string | null) ?? null,
    chart: (r.chart_spec as ChartSpec | null) ?? null,
    result: (r.cached_result as QueryResult | null) ?? null,
    cachedAt: (r.cached_at as string | null) ?? null,
    textMd: (r.text_md as string | null) ?? null,
    createdByEmail: (r.created_by_email as string | null) ?? null,
  };
}

export const dashboardStore: DashboardStore = {
  async listDashboards() {
    const { data, error } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`listDashboards: ${error.message}`);
    return (data ?? []).map((r) => toDashboardSummary(r as Record<string, unknown>));
  },

  async createDashboard({ name, userEmail }) {
    const { data, error } = await db()
      .from("dashboards")
      .insert({ name, created_by_email: userEmail })
      .select("id")
      .single();
    if (error) throw new Error(`createDashboard: ${error.message}`);
    return { id: data!.id as string };
  },

  async getDashboard(id) {
    const { data: dash, error: dErr } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .eq("id", id)
      .single();
    if (dErr) throw new Error(`getDashboard(dashboard): ${dErr.message}`);
    const { data: rows, error: wErr } = await db()
      .from("widgets")
      .select(
        "id, dashboard_id, kind, title, position, size, question, sql, chart_spec, cached_result, cached_at, text_md, created_by_email"
      )
      .eq("dashboard_id", id)
      .order("position", { ascending: true });
    if (wErr) throw new Error(`getDashboard(widgets): ${wErr.message}`);
    return {
      dashboard: toDashboardSummary(dash as Record<string, unknown>),
      widgets: (rows ?? []).map((r) => toWidget(r as Record<string, unknown>)),
    };
  },

  async renameDashboard(id, name) {
    const { error } = await db().from("dashboards").update({ name }).eq("id", id);
    if (error) throw new Error(`renameDashboard: ${error.message}`);
  },

  async deleteDashboard(id) {
    const { error } = await db().from("dashboards").delete().eq("id", id);
    if (error) throw new Error(`deleteDashboard: ${error.message}`);
  },

  async createWidget(dashboardId, input) {
    // position defaults to current max + 1
    const { data: last, error: pErr } = await db()
      .from("widgets")
      .select("position")
      .eq("dashboard_id", dashboardId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pErr) throw new Error(`createWidget(position): ${pErr.message}`);
    const position = ((last?.position as number | undefined) ?? -1) + 1;
    const hasResult = input.result != null;
    const { data, error } = await db()
      .from("widgets")
      .insert({
        dashboard_id: dashboardId,
        kind: input.kind,
        title: input.title,
        position,
        size: input.size,
        question: input.question,
        sql: input.sql,
        chart_spec: input.chart,
        cached_result: input.result,
        cached_at: hasResult ? new Date().toISOString() : null,
        text_md: input.textMd,
      })
      .select("id")
      .single();
    if (error) throw new Error(`createWidget(insert): ${error.message}`);
    return { id: data!.id as string };
  },

  async updateWidget(id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.size !== undefined) row.size = patch.size;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.chart !== undefined) row.chart_spec = patch.chart;
    if (patch.textMd !== undefined) row.text_md = patch.textMd;
    if (patch.position !== undefined) row.position = patch.position;
    if (patch.question !== undefined) row.question = patch.question;
    if (patch.sql !== undefined) row.sql = patch.sql;
    if (patch.result !== undefined) {
      row.cached_result = patch.result;
      row.cached_at = patch.result ? new Date().toISOString() : null;
    }
    const { error } = await db().from("widgets").update(row).eq("id", id);
    if (error) throw new Error(`updateWidget: ${error.message}`);
  },

  async deleteWidget(id) {
    const { error } = await db().from("widgets").delete().eq("id", id);
    if (error) throw new Error(`deleteWidget: ${error.message}`);
  },

  async reorderWidgets(positions) {
    const entries = Object.entries(positions);
    await Promise.all(
      entries.map(([id, position]) =>
        db()
          .from("widgets")
          .update({ position })
          .eq("id", id)
          .then(({ error }) => {
            if (error) throw new Error(`reorderWidgets(${id}): ${error.message}`);
          })
      )
    );
  },

  async refreshWidget(id) {
    const { data: w, error } = await db()
      .from("widgets")
      .select("sql")
      .eq("id", id)
      .single();
    if (error) throw new Error(`refreshWidget(load): ${error.message}`);
    const sql = w?.sql as string | null;
    if (!sql) throw new Error("refreshWidget: widget has no SQL to run");

    const v = validateSelect(sql, 1000);
    if (!v.ok) throw new Error(`refreshWidget(validate): ${v.error}`);
    const fresh = await executeReadOnly(v.sql);
    const capped = capRows(fresh)!;

    const { error: uErr } = await db()
      .from("widgets")
      .update({ cached_result: capped, cached_at: new Date().toISOString() })
      .eq("id", id);
    if (uErr) throw new Error(`refreshWidget(save): ${uErr.message}`);
    return capped;
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no type errors). If `widgets(count)` typing complains, the `as Record<string, unknown>` casts in the mappers absorb it — confirm no errors remain.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/dashboards.ts
git commit -m "feat(dashboards): dashboardStore (CRUD + reorder + LLM-free refresh)"
```

---

## Task 4: Dashboard list/create/get/rename/delete routes

**Files:**
- Create: `src/app/api/agent/dashboards/route.ts`
- Create: `src/app/api/agent/dashboards/[id]/route.ts`

No unit tests (route glue, per convention). Verify with `npm run build`.

- [ ] **Step 1: List + create route**

Create `src/app/api/agent/dashboards/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dashboards = await dashboardStore.listDashboards();
    return NextResponse.json({ dashboards });
  } catch (err) {
    console.error("listDashboards failed:", err);
    return NextResponse.json({ error: "Could not list dashboards" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled dashboard";
  try {
    const { id } = await dashboardStore.createDashboard({ name, userEmail: email });
    return NextResponse.json({ id });
  } catch (err) {
    console.error("createDashboard failed:", err);
    return NextResponse.json({ error: "Could not create dashboard" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Get + rename + delete route**

Create `src/app/api/agent/dashboards/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await dashboardStore.getDashboard(params.id);
    return NextResponse.json(data);
  } catch (err) {
    console.error("getDashboard failed:", err);
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    await dashboardStore.renameDashboard(params.id, body.name.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("renameDashboard failed:", err);
    return NextResponse.json({ error: "Could not rename dashboard" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await dashboardStore.deleteDashboard(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteDashboard failed:", err);
    return NextResponse.json({ error: "Could not delete dashboard" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add src/app/api/agent/dashboards/route.ts "src/app/api/agent/dashboards/[id]/route.ts"
git commit -m "feat(dashboards): dashboard list/create/get/rename/delete routes"
```

---

## Task 5: Widget routes (create, patch, delete, reorder, refresh)

**Files:**
- Create: `src/app/api/agent/dashboards/[id]/widgets/route.ts`
- Create: `src/app/api/agent/dashboards/[id]/reorder/route.ts`
- Create: `src/app/api/agent/widgets/[id]/route.ts`
- Create: `src/app/api/agent/widgets/[id]/refresh/route.ts`

No unit tests (route glue). Verify with `npm run build`.

- [ ] **Step 1: Create-widget route**

Create `src/app/api/agent/dashboards/[id]/widgets/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";
import type { WidgetCreateInput } from "@/lib/integrations/ulink-agent/widgets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Partial<WidgetCreateInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.kind || !body.title || !body.size) {
    return NextResponse.json({ error: "kind, title, and size are required" }, { status: 400 });
  }
  const input: WidgetCreateInput = {
    kind: body.kind,
    title: body.title,
    size: body.size,
    question: body.question ?? null,
    sql: body.sql ?? null,
    chart: body.chart ?? null,
    result: body.result ?? null,
    textMd: body.textMd ?? null,
  };
  try {
    const { id } = await dashboardStore.createWidget(params.id, input);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("createWidget failed:", err);
    return NextResponse.json({ error: "Could not create widget" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Reorder route**

Create `src/app/api/agent/dashboards/[id]/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { positions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const positions = body.positions;
  if (typeof positions !== "object" || positions === null) {
    return NextResponse.json({ error: "positions object is required" }, { status: 400 });
  }
  try {
    await dashboardStore.reorderWidgets(positions as Record<string, number>);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reorderWidgets failed:", err);
    return NextResponse.json({ error: "Could not reorder widgets" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Widget patch + delete route**

Create `src/app/api/agent/widgets/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let patch: WidgetPatch;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await dashboardStore.updateWidget(params.id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updateWidget failed:", err);
    return NextResponse.json({ error: "Could not update widget" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await dashboardStore.deleteWidget(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteWidget failed:", err);
    return NextResponse.json({ error: "Could not delete widget" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Refresh route**

Create `src/app/api/agent/widgets/[id]/refresh/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await dashboardStore.refreshWidget(params.id);
    return NextResponse.json({ result });
  } catch (err) {
    console.error("refreshWidget failed:", err);
    return NextResponse.json({ error: "Could not refresh widget" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add "src/app/api/agent/dashboards/[id]/widgets/route.ts" "src/app/api/agent/dashboards/[id]/reorder/route.ts" "src/app/api/agent/widgets/[id]/route.ts" "src/app/api/agent/widgets/[id]/refresh/route.ts"
git commit -m "feat(dashboards): widget create/patch/delete/reorder/refresh routes"
```

---

## Task 6: Query route — support `persist: false`

**Files:**
- Modify: `src/app/api/agent/query/route.ts`

So the in-place composer can stream an answer without creating an orphan conversation. No unit test (route). Verify with `npm run build` + existing tests stay green.

- [ ] **Step 1: Read `persist` from the body**

In `src/app/api/agent/query/route.ts`, update the body type and parse. Change the body type declaration (line ~16) to include `persist`:

```ts
  let body: { question?: unknown; history?: unknown; conversationId?: unknown; persist?: unknown };
```

After the `conversationId` line (~30), add:

```ts
  const persist = body.persist !== false; // default true; the dashboard composer sends false
```

- [ ] **Step 2: Guard the persistence block**

Wrap the existing persist block so it only runs when `persist` is true. Replace:

```ts
        // Persist the turn (best-effort: never break the answer if storage fails).
        try {
          const { conversationId: id, title } = await persistTurn(conversationStore, {
            question,
            conversationId,
            userEmail,
            events: collected,
          });
          emit({ type: "conversation", conversationId: id, title });
        } catch (persistErr) {
          console.error("Persist turn failed:", persistErr);
        }
```

with:

```ts
        // Persist the turn (best-effort: never break the answer if storage fails).
        // The dashboard composer streams with persist:false — it composes a widget and
        // must not create a conversation.
        if (persist) {
          try {
            const { conversationId: id, title } = await persistTurn(conversationStore, {
              question,
              conversationId,
              userEmail,
              events: collected,
            });
            emit({ type: "conversation", conversationId: id, title });
          } catch (persistErr) {
            console.error("Persist turn failed:", persistErr);
          }
        }
```

- [ ] **Step 3: Verify + commit**

Run: `npm run build` and `npx vitest run` (expect success; all existing tests green).

```bash
git add src/app/api/agent/query/route.ts
git commit -m "feat(dashboards): query route honors persist:false for in-place compose"
```

---

## Task 7: Dashboard data hooks

**Files:**
- Create: `src/hooks/use-dashboards.ts`
- Create: `src/hooks/use-dashboard.ts`

No unit tests (hooks, per convention). Verify with `npm run build`.

- [ ] **Step 1: List hook**

Create `src/hooks/use-dashboards.ts` (mirrors `use-conversation-list.ts`):

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardSummary } from "@/lib/integrations/ulink-agent/types";

export function useDashboards() {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/dashboards");
      if (!res.ok) return;
      const data = (await res.json()) as { dashboards: DashboardSummary[] };
      setDashboards(data.dashboards ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const res = await fetch("/api/agent/dashboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id: string };
        void refresh();
        return data.id;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setDashboards((prev) => prev.filter((d) => d.id !== id)); // optimistic
      try {
        await fetch(`/api/agent/dashboards/${id}`, { method: "DELETE" });
      } catch {
        void refresh();
      }
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { dashboards, refresh, create, remove };
}
```

- [ ] **Step 2: Single-dashboard hook**

Create `src/hooks/use-dashboard.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { isStale } from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetCreateInput, WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type {
  DashboardSummary,
  QueryResult,
  Widget,
} from "@/lib/integrations/ulink-agent/types";

export function useDashboard(id: string) {
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const setWidget = useCallback((wid: string, fn: (w: Widget) => Widget) => {
    setWidgets((prev) => prev.map((w) => (w.id === wid ? fn(w) : w)));
  }, []);

  const refreshWidget = useCallback(
    async (wid: string) => {
      try {
        const res = await fetch(`/api/agent/widgets/${wid}/refresh`, { method: "POST" });
        if (!res.ok) {
          setWidget(wid, (w) => ({ ...w, refreshError: true }));
          return;
        }
        const data = (await res.json()) as { result: QueryResult };
        setWidget(wid, (w) => ({
          ...w,
          result: data.result,
          cachedAt: new Date().toISOString(),
          refreshError: false,
        }));
      } catch {
        setWidget(wid, (w) => ({ ...w, refreshError: true }));
      }
    },
    [setWidget]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/dashboards/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as { dashboard: DashboardSummary; widgets: Widget[] };
      setDashboard(data.dashboard);
      setWidgets(data.widgets);
      // Auto-refresh stale query widgets in the background (no spinner).
      const now = Date.now();
      data.widgets
        .filter((w) => w.kind !== "text" && w.sql && isStale(w.cachedAt, now))
        .forEach((w) => void refreshWidget(w.id));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, refreshWidget]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAll = useCallback(() => {
    widgets
      .filter((w) => w.kind !== "text" && w.sql)
      .forEach((w) => void refreshWidget(w.id));
  }, [widgets, refreshWidget]);

  const addWidget = useCallback(
    async (input: WidgetCreateInput) => {
      const res = await fetch(`/api/agent/dashboards/${id}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) await load();
    },
    [id, load]
  );

  const updateWidget = useCallback(
    async (wid: string, patch: WidgetPatch) => {
      setWidget(wid, (w) => ({ ...w, ...patch } as Widget)); // optimistic for simple fields
      try {
        await fetch(`/api/agent/widgets/${wid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch {
        void load();
      }
    },
    [id, setWidget, load]
  );

  const removeWidget = useCallback(
    async (wid: string) => {
      setWidgets((prev) => prev.filter((w) => w.id !== wid)); // optimistic
      try {
        await fetch(`/api/agent/widgets/${wid}`, { method: "DELETE" });
      } catch {
        void load();
      }
    },
    [load]
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      const positions = orderedIds.reduce<Record<string, number>>((acc, wid, i) => {
        acc[wid] = i;
        return acc;
      }, {});
      setWidgets((prev) =>
        [...prev].sort((a, b) => (positions[a.id] ?? 0) - (positions[b.id] ?? 0))
      ); // optimistic
      try {
        await fetch(`/api/agent/dashboards/${id}/reorder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions }),
        });
      } catch {
        void load();
      }
    },
    [id, load]
  );

  const rename = useCallback(
    async (name: string) => {
      setDashboard((d) => (d ? { ...d, name } : d)); // optimistic
      try {
        await fetch(`/api/agent/dashboards/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      } catch {
        void load();
      }
    },
    [id, load]
  );

  return {
    dashboard,
    widgets,
    loading,
    notFound,
    refreshWidget,
    refreshAll,
    addWidget,
    updateWidget,
    removeWidget,
    reorder,
    rename,
  };
}
```

Note: `refreshError` is a transient client-only flag on `Widget`. Add it to the `Widget` interface in `types.ts` as an optional field so the spreads typecheck:

In `src/lib/integrations/ulink-agent/types.ts`, add to `interface Widget` (after `createdByEmail`):

```ts
  refreshError?: boolean; // transient client-only: last refresh failed, showing cached
```

- [ ] **Step 3: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add src/hooks/use-dashboards.ts src/hooks/use-dashboard.ts src/lib/integrations/ulink-agent/types.ts
git commit -m "feat(dashboards): useDashboards + useDashboard hooks (load/refresh/mutate)"
```

---

## Task 8: KPI render + widget body renderer

**Files:**
- Create: `src/components/dashboard-builder/widget-body.tsx`

A presentational component that renders a widget's content by `kind`, reusing the existing `Chart`/table by constructing an `AgentAnswer` for `ResultView`. No unit test (component). Verify with `npm run build`.

- [ ] **Step 1: Implement the body renderer**

Create `src/components/dashboard-builder/widget-body.tsx`:

```tsx
"use client";

import { ResultView } from "@/components/agent/result-view";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";
import type { Widget } from "@/lib/integrations/ulink-agent/types";

function formatKpi(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value).toLocaleString();
  }
  return value === null || value === undefined ? "—" : String(value);
}

export function WidgetBody({ widget }: { widget: Widget }) {
  if (widget.kind === "text") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        {widget.textMd || ""}
      </p>
    );
  }

  if (!widget.result) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }

  if (widget.kind === "kpi") {
    const col = widget.result.columns[0];
    const value = widget.result.rows[0]?.[col];
    return (
      <div className="py-2">
        <div className="text-3xl font-bold tabular-nums">{formatKpi(value)}</div>
      </div>
    );
  }

  // chart / table → reuse ResultView. Force chart off for table kind.
  const answer: AgentAnswer = {
    ok: true,
    sql: widget.sql,
    chart: widget.kind === "chart" ? widget.chart : { type: "none", xColumn: null, yColumn: null },
    result: widget.result,
    error: null,
    attempts: 0,
    logId: null,
  };
  return <ResultView answer={answer} />;
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add src/components/dashboard-builder/widget-body.tsx
git commit -m "feat(dashboards): widget body renderer (kpi/chart/table/text)"
```

---

## Task 9: Widget card (chrome + edit controls)

**Files:**
- Create: `src/components/dashboard-builder/dashboard-widget.tsx`

The card around `WidgetBody`: title, freshness line, refresh button, and edit-mode controls (size, kind, chart type, edit-query, remove). Drag handle is rendered but wired by the grid in Task 10. No unit test. Verify with `npm run build`.

- [ ] **Step 1: Implement the card**

Create `src/components/dashboard-builder/dashboard-widget.tsx`:

```tsx
"use client";

import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Trash2, GripVertical, Pencil } from "lucide-react";
import { WidgetBody } from "./widget-body";
import { cn } from "@/lib/utils";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget, WidgetKind, WidgetSize } from "@/lib/integrations/ulink-agent/types";

const SIZES: WidgetSize[] = ["sm", "md", "full"];
const SIZE_LABEL: Record<WidgetSize, string> = { sm: "S", md: "M", full: "Full" };
const KINDS: WidgetKind[] = ["chart", "table", "kpi"];
const CHART_TYPES = ["bar", "line", "area"] as const;

export function DashboardWidget({
  widget,
  editing,
  dragHandleProps,
  onRefresh,
  onPatch,
  onRemove,
  onEditQuery,
}: {
  widget: Widget;
  editing: boolean;
  dragHandleProps?: Record<string, unknown>;
  onRefresh: () => void;
  onPatch: (patch: WidgetPatch) => void;
  onRemove: () => void;
  onEditQuery: () => void;
}) {
  const isQuery = widget.kind !== "text";
  const freshness = widget.refreshError
    ? "couldn't refresh — showing cached"
    : widget.cachedAt
    ? `updated ${formatDistanceToNow(new Date(widget.cachedAt), { addSuffix: true })}`
    : isQuery
    ? "📷 cached"
    : "";

  return (
    <div className="flex h-full flex-col rounded-lg border border-border/50 bg-card p-4">
      <div className="mb-2 flex items-start gap-2">
        {editing && (
          <button
            type="button"
            className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{widget.title}</h3>
          {freshness && (
            <p className={cn("text-xs", widget.refreshError ? "text-amber-500" : "text-muted-foreground")}>
              {freshness}
            </p>
          )}
        </div>
        {isQuery && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1">
        <WidgetBody widget={widget} />
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-xs">
          {/* size */}
          <div className="flex overflow-hidden rounded-md border border-border/50">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPatch({ size: s })}
                className={cn("px-2 py-1", widget.size === s ? "bg-violet-600 text-white" : "hover:bg-accent")}
              >
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>

          {/* render kind (query widgets only) */}
          {isQuery && (
            <div className="flex overflow-hidden rounded-md border border-border/50">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPatch({ kind: k })}
                  className={cn("px-2 py-1 capitalize", widget.kind === k ? "bg-violet-600 text-white" : "hover:bg-accent")}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {/* chart type (chart kind only) */}
          {widget.kind === "chart" && (
            <div className="flex overflow-hidden rounded-md border border-border/50">
              {CHART_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    onPatch({ chart: { type: t, xColumn: widget.chart?.xColumn ?? null, yColumn: widget.chart?.yColumn ?? null } })
                  }
                  className={cn("px-2 py-1 capitalize", widget.chart?.type === t ? "bg-violet-600 text-white" : "hover:bg-accent")}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {isQuery && (
            <button
              type="button"
              onClick={onEditQuery}
              className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 hover:bg-accent"
            >
              <Pencil className="h-3 w-3" /> Edit query
            </button>
          )}

          <button
            type="button"
            onClick={onRemove}
            className="ml-auto flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add src/components/dashboard-builder/dashboard-widget.tsx
git commit -m "feat(dashboards): widget card chrome + edit controls"
```

---

## Task 10: Responsive grid with drag-reorder (`@dnd-kit`)

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- Create: `src/components/dashboard-builder/dashboard-grid.tsx`

No unit test. Verify with `npm run build`.

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
npm install @dnd-kit/core@^6 @dnd-kit/sortable@^8 @dnd-kit/utilities@^3
```

Expected: `package.json` + `package-lock.json` updated; install succeeds.

- [ ] **Step 2: Implement the grid**

Create `src/components/dashboard-builder/dashboard-grid.tsx`:

```tsx
"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DashboardWidget } from "./dashboard-widget";
import { sizeToCols } from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget } from "@/lib/integrations/ulink-agent/types";

const SPAN_CLASS: Record<number, string> = {
  4: "md:col-span-4",
  6: "md:col-span-6",
  12: "md:col-span-12",
};

function SortableCell({
  widget,
  editing,
  onRefresh,
  onPatch,
  onRemove,
  onEditQuery,
}: {
  widget: Widget;
  editing: boolean;
  onRefresh: () => void;
  onPatch: (patch: WidgetPatch) => void;
  onRemove: () => void;
  onEditQuery: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={SPAN_CLASS[sizeToCols(widget.size)]}>
      <DashboardWidget
        widget={widget}
        editing={editing}
        dragHandleProps={{ ...attributes, ...listeners }}
        onRefresh={onRefresh}
        onPatch={onPatch}
        onRemove={onRemove}
        onEditQuery={onEditQuery}
      />
    </div>
  );
}

export function DashboardGrid({
  widgets,
  editing,
  onReorder,
  onRefreshWidget,
  onPatchWidget,
  onRemoveWidget,
  onEditQuery,
  children,
}: {
  widgets: Widget[];
  editing: boolean;
  onReorder: (orderedIds: string[]) => void;
  onRefreshWidget: (id: string) => void;
  onPatchWidget: (id: string, patch: WidgetPatch) => void;
  onRemoveWidget: (id: string) => void;
  onEditQuery: (id: string) => void;
  children?: React.ReactNode; // the "Add widget" tile, rendered after the cells
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = widgets.map((w) => w.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {widgets.map((w) => (
            <SortableCell
              key={w.id}
              widget={w}
              editing={editing}
              onRefresh={() => onRefreshWidget(w.id)}
              onPatch={(patch) => onPatchWidget(w.id, patch)}
              onRemove={() => onRemoveWidget(w.id)}
              onEditQuery={() => onEditQuery(w.id)}
            />
          ))}
          {children}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add package.json package-lock.json src/components/dashboard-builder/dashboard-grid.tsx
git commit -m "feat(dashboards): responsive 12-col grid with @dnd-kit reorder"
```

---

## Task 11: In-place compose hook + Add-widget composer

**Files:**
- Create: `src/hooks/use-agent-compose.ts`
- Create: `src/components/dashboard-builder/add-widget-composer.tsx`

The compose hook streams a single answer with `persist:false`; the composer turns it (or a text note) into a `WidgetCreateInput`. No unit test. Verify with `npm run build`.

- [ ] **Step 1: Compose hook**

Create `src/hooks/use-agent-compose.ts`:

```ts
"use client";

import { useCallback, useState } from "react";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import { applyEvent, emptyMessage, type AgentMessage } from "@/lib/integrations/ulink-agent/message";

export function useAgentCompose() {
  const [message, setMessage] = useState<AgentMessage | null>(null);

  const update = (fn: (m: AgentMessage) => AgentMessage) =>
    setMessage((m) => (m ? fn(m) : m));

  const run = useCallback(async (question: string) => {
    setMessage(emptyMessage("compose", question));
    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: [], persist: false }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as AgentEvent;
          if (event.type === "conversation") return; // never emitted with persist:false, but ignore
          update((m) => applyEvent(m, event));
        } catch {
          /* skip malformed line */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      consume(buffer);
      update((m) => (m.loading ? { ...m, loading: false } : m));
    } catch {
      update((m) => ({ ...m, loading: false, phase: "error", error: m.error ?? "Network error" }));
    }
  }, []);

  const reset = useCallback(() => setMessage(null), []);

  return { message, run, reset };
}
```

- [ ] **Step 2: Add-widget composer**

Create `src/components/dashboard-builder/add-widget-composer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus, Sparkles, Type, X, Loader2 } from "lucide-react";
import { useAgentCompose } from "@/hooks/use-agent-compose";
import { WidgetBody } from "./widget-body";
import { widgetFromAnswer } from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetCreateInput } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget, WidgetKind, WidgetSize } from "@/lib/integrations/ulink-agent/types";

type Mode = "tile" | "menu" | "query" | "text";

export function AddWidgetComposer({ onAdd }: { onAdd: (input: WidgetCreateInput) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>("tile");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<WidgetSize>("md");
  const [textBody, setTextBody] = useState("");
  const [saving, setSaving] = useState(false);
  const { message, run, reset } = useAgentCompose();

  function close() {
    setMode("tile");
    setQuestion("");
    setTitle("");
    setTextBody("");
    setSize("md");
    reset();
  }

  async function addQueryWidget() {
    if (!message || message.loading || message.error || !message.result) return;
    setSaving(true);
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      chart: message.chart,
      result: message.result,
      title: title || message.question,
      size,
    });
    await onAdd(input);
    setSaving(false);
    close();
  }

  async function addTextWidget() {
    if (!title.trim() && !textBody.trim()) return;
    setSaving(true);
    const input: WidgetCreateInput = {
      kind: "text",
      title: title.trim() || "Note",
      size,
      question: null,
      sql: null,
      chart: null,
      result: null,
      textMd: textBody,
    };
    await onAdd(input);
    setSaving(false);
    close();
  }

  // Preview as a faux widget so it looks like it will on the dashboard.
  const previewWidget: Widget | null = message
    ? {
        id: "preview",
        dashboardId: "",
        kind: (message.result ? widgetFromAnswer({ question: message.question, sql: message.sql, chart: message.chart, result: message.result }).kind : "table") as WidgetKind,
        title: title || message.question,
        position: 0,
        size,
        question: message.question,
        sql: message.sql,
        chart: message.chart,
        result: message.result,
        cachedAt: null,
        textMd: null,
        createdByEmail: null,
      }
    : null;

  if (mode === "tile") {
    return (
      <button
        type="button"
        onClick={() => setMode("menu")}
        className="col-span-1 flex min-h-[160px] items-center justify-center rounded-lg border-2 border-dashed border-border/60 text-sm text-muted-foreground hover:border-violet-500/60 hover:text-foreground md:col-span-6"
      >
        <Plus className="mr-2 h-4 w-4" /> Add widget
      </button>
    );
  }

  return (
    <div className="col-span-1 rounded-lg border border-violet-500/40 bg-card p-4 md:col-span-12">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add a widget</h3>
        <button type="button" onClick={close} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode === "menu" && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode("query")}
            className="flex flex-1 items-center gap-2 rounded-lg border border-border/50 p-3 text-sm hover:bg-accent"
          >
            <Sparkles className="h-4 w-4 text-violet-400" /> Ask the agent
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className="flex flex-1 items-center gap-2 rounded-lg border border-border/50 p-3 text-sm hover:bg-accent"
          >
            <Type className="h-4 w-4" /> Text note
          </button>
        </div>
      )}

      {mode === "query" && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) void run(question.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. signups per week over the last 8 weeks"
              className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
            <button type="submit" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500">
              Run
            </button>
          </form>

          {message?.loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Working…
            </div>
          )}
          {message?.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{message.error}</div>
          )}
          {previewWidget && previewWidget.result && (
            <div className="rounded-lg border border-border/50 p-3">
              <WidgetBody widget={previewWidget} />
            </div>
          )}

          {message && !message.loading && !message.error && message.result && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={message.question}
                className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm outline-none focus:border-violet-500"
              />
              <SizePicker size={size} onChange={setSize} />
              <button
                type="button"
                disabled={saving}
                onClick={() => void addQueryWidget()}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                Add to dashboard
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "text" && (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <textarea
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            placeholder="Write a note…"
            rows={3}
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <div className="flex items-center gap-2">
            <SizePicker size={size} onChange={setSize} />
            <button
              type="button"
              disabled={saving}
              onClick={() => void addTextWidget()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Add note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SizePicker({ size, onChange }: { size: WidgetSize; onChange: (s: WidgetSize) => void }) {
  const sizes: { k: WidgetSize; label: string }[] = [
    { k: "sm", label: "S" },
    { k: "md", label: "M" },
    { k: "full", label: "Full" },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
      {sizes.map((s) => (
        <button
          key={s.k}
          type="button"
          onClick={() => onChange(s.k)}
          className={size === s.k ? "bg-violet-600 px-2 py-1.5 text-white" : "px-2 py-1.5 hover:bg-accent"}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run build` (expect success).

```bash
git add src/hooks/use-agent-compose.ts src/components/dashboard-builder/add-widget-composer.tsx
git commit -m "feat(dashboards): in-place compose hook + add-widget composer"
```

---

## Task 12: Dashboards list page + sidebar nav

**Files:**
- Create: `src/app/(dashboard)/dashboards/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

No unit test. Verify with `npm run build` + manual smoke.

- [ ] **Step 1: Add the sidebar nav item**

In `src/components/layout/sidebar.tsx`, add `LayoutDashboard` to the `lucide-react` import line:

```tsx
import { BarChart3, Globe, Link2, Flame, X, MessageSquare, LayoutDashboard } from "lucide-react";
```

Then add a nav entry to the `navItems` array, immediately after the `/agent` entry:

```tsx
    {
      href: "/dashboards",
      label: "Dashboards",
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
```

- [ ] **Step 2: List page**

Create `src/app/(dashboard)/dashboards/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plus, Trash2, LayoutDashboard } from "lucide-react";
import { useDashboards } from "@/hooks/use-dashboards";

export default function DashboardsPage() {
  const { dashboards, create, remove } = useDashboards();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    await create(name.trim());
    setName("");
    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
          <p className="text-muted-foreground">Compose views from PM Data Agent results. Shared across the team.</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New dashboard name…"
          className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> New dashboard
        </button>
      </form>

      {dashboards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No dashboards yet. Create one above, or pin an answer from the PM Agent.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <div key={d.id} className="group relative rounded-lg border border-border/50 bg-card p-4 transition-shadow hover:shadow-md">
              <Link href={`/dashboards/${d.id}`} className="block">
                <div className="mb-2 flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4 text-violet-400" />
                  <h3 className="truncate font-semibold">{d.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.widgetCount} widget{d.widgetCount === 1 ? "" : "s"} · updated{" "}
                  {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
                </p>
                {d.createdByEmail && (
                  <p className="mt-1 text-xs text-muted-foreground/60">{d.createdByEmail}</p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => void remove(d.id)}
                className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-red-400 group-hover:opacity-100"
                aria-label="Delete dashboard"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify + manual smoke + commit**

Run: `npm run build` (expect success). Manual: `npm run dev -- -p 3002`, sign in, open `/dashboards`, create one, confirm it appears, delete it.

```bash
git add "src/app/(dashboard)/dashboards/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(dashboards): dashboards list page + sidebar nav"
```

---

## Task 13: Dashboard detail page

**Files:**
- Create: `src/app/(dashboard)/dashboards/[id]/page.tsx`

Wires `useDashboard` + grid + composer + edit toggle + rename + refresh-all + edit-query. No unit test. Verify with `npm run build` + manual smoke.

- [ ] **Step 1: Detail page**

Create `src/app/(dashboard)/dashboards/[id]/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Pencil, Check, ArrowLeft } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DashboardGrid } from "@/components/dashboard-builder/dashboard-grid";
import { AddWidgetComposer } from "@/components/dashboard-builder/add-widget-composer";

export default function DashboardDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const {
    dashboard,
    widgets,
    loading,
    notFound,
    refreshWidget,
    refreshAll,
    addWidget,
    updateWidget,
    removeWidget,
    reorder,
    rename,
  } = useDashboard(params.id);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (notFound) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push("/dashboards")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to dashboards
        </button>
        <p className="text-sm text-muted-foreground">This dashboard doesn&apos;t exist.</p>
      </div>
    );
  }

  function onEditQuery(id: string) {
    const w = widgets.find((x) => x.id === id);
    if (!w) return;
    const next = window.prompt("Re-ask the agent for this widget:", w.question ?? "");
    if (next === null || !next.trim()) return;
    // Re-run via the compose endpoint, then patch the widget with the new query + result.
    void (async () => {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: next.trim(), history: [], persist: false }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sql: string | null = null;
      let chart = null as unknown;
      let result = null as unknown;
      const consume = (line: string) => {
        const t = line.trim();
        if (!t) return;
        try {
          const e = JSON.parse(t) as { type: string; [k: string]: unknown };
          if (e.type === "sql") sql = e.sql as string;
          if (e.type === "result")
            result = { columns: e.columns, rows: e.rows, rowCount: e.rowCount };
          if (e.type === "result") chart = e.chart;
        } catch {
          /* skip */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) consume(l);
      }
      consume(buffer);
      await updateWidget(id, {
        question: next.trim(),
        sql,
        chart: chart as never,
        result: result as never,
      });
    })();
  }

  return (
    <div className="space-y-6">
      <button onClick={() => router.push("/dashboards")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboards
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <input
            value={nameDraft ?? dashboard?.name ?? ""}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft !== null && nameDraft.trim() && nameDraft !== dashboard?.name) {
                void rename(nameDraft.trim());
              }
              setNameDraft(null);
            }}
            className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xl font-bold outline-none focus:border-violet-500"
          />
        ) : (
          <h1 className="text-2xl font-bold tracking-tight">{dashboard?.name ?? "…"}</h1>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" /> Refresh all
          </button>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 text-sm hover:bg-accent"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {loading && widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DashboardGrid
          widgets={widgets}
          editing={editing}
          onReorder={reorder}
          onRefreshWidget={refreshWidget}
          onPatchWidget={updateWidget}
          onRemoveWidget={removeWidget}
          onEditQuery={onEditQuery}
        >
          <AddWidgetComposer onAdd={addWidget} />
        </DashboardGrid>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + manual smoke + commit**

Run: `npm run build` (expect success). Manual: open a dashboard, add a widget via "Ask the agent", confirm it renders and persists on reload; toggle Edit, change a size and drag to reorder, confirm order persists on reload; click a widget's refresh.

```bash
git add "src/app/(dashboard)/dashboards/[id]/page.tsx"
git commit -m "feat(dashboards): dashboard detail page (grid + compose + edit/reorder/refresh)"
```

---

## Task 14: Pin-to-dashboard from chat

**Files:**
- Create: `src/components/agent/pin-to-dashboard.tsx`
- Modify: `src/components/agent/agent-message.tsx`

Adds the "Add to dashboard" control to finished chat answers. No unit test. Verify with `npm run build` + manual smoke.

- [ ] **Step 1: Pin control (Radix popover)**

Create `src/components/agent/pin-to-dashboard.tsx`:

```tsx
"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { LayoutDashboard, Plus, Check } from "lucide-react";
import { useDashboards } from "@/hooks/use-dashboards";
import { widgetFromAnswer } from "@/lib/integrations/ulink-agent/widgets";
import type { AgentMessage } from "@/lib/integrations/ulink-agent/message";

export function PinToDashboard({ message }: { message: AgentMessage }) {
  const { dashboards, create } = useDashboards();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pin(dashboardId: string) {
    setBusy(true);
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      chart: message.chart,
      result: message.result,
    });
    const res = await fetch(`/api/agent/dashboards/${dashboardId}/widgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setBusy(false);
    if (res.ok) setSavedTo(dashboardId);
  }

  async function pinToNew() {
    if (!newName.trim()) return;
    setBusy(true);
    const id = await create(newName.trim());
    setNewName("");
    if (id) await pin(id);
    else setBusy(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSavedTo(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LayoutDashboard className="h-4 w-4" /> Add to dashboard
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-border/50 bg-card p-2 shadow-lg"
        >
          {savedTo ? (
            <div className="space-y-2 p-2 text-sm">
              <div className="flex items-center gap-2 text-green-400">
                <Check className="h-4 w-4" /> Added
              </div>
              <Link
                href={`/dashboards/${savedTo}`}
                className="block text-violet-400 hover:text-violet-300"
              >
                View dashboard →
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Pin to…</p>
              <div className="max-h-48 overflow-y-auto">
                {dashboards.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void pin(d.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 text-violet-400" />
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 border-t border-border/50 pt-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New dashboard…"
                  className="flex-1 rounded-md border border-border/50 bg-background px-2 py-1 text-sm outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  disabled={busy || !newName.trim()}
                  onClick={() => void pinToNew()}
                  className="rounded-md p-1.5 text-violet-400 hover:bg-accent disabled:opacity-50"
                  aria-label="Create and pin"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 2: Render it in the chat message**

In `src/components/agent/agent-message.tsx`, add the import at the top (after the `ResultView` import):

```tsx
import { PinToDashboard } from "@/components/agent/pin-to-dashboard";
```

Then, inside the feedback block, add the pin control. Find the feedback `<div>` (the one gated by `finished && !message.error && message.logId`) and add `<PinToDashboard message={message} />` after the `feedback === "up"` span, but ALSO render pinning whenever there's a result even without a logId. Replace the whole feedback block:

```tsx
      {/* feedback + pin */}
      {finished && !message.error && (message.logId || message.result) && (
        <div className="flex items-center gap-2">
          {message.logId && (
            <>
              <button
                onClick={() => onFeedback(message.id, message.logId!, true)}
                className={cn("rounded-md p-1.5 hover:bg-accent", message.feedback === "up" && "text-green-400")}
                aria-label="Helpful"
              >
                <ThumbsUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => onFeedback(message.id, message.logId!, false)}
                className={cn("rounded-md p-1.5 hover:bg-accent", message.feedback === "down" && "text-red-400")}
                aria-label="Not helpful"
              >
                <ThumbsDown className="h-4 w-4" />
              </button>
              {message.feedback === "up" && (
                <span className="text-xs text-muted-foreground">Saved as a trusted example</span>
              )}
            </>
          )}
          {message.result && <PinToDashboard message={message} />}
        </div>
      )}
```

- [ ] **Step 3: Verify + manual smoke + commit**

Run: `npm run build` (expect success). Manual: in the chat, ask a data question, click "Add to dashboard", pin to a new dashboard, follow "View dashboard →", confirm the widget is there.

```bash
git add src/components/agent/pin-to-dashboard.tsx src/components/agent/agent-message.tsx
git commit -m "feat(dashboards): pin chat answers to a dashboard"
```

---

## Task 15: Full-feature review & finishing

- [ ] **Step 1: Full test + build gate**

Run: `npx vitest run` (all suites green, including `widgets.test.ts`) and `npm run build` (clean).

- [ ] **Step 2: End-to-end manual smoke (signed in, `npm run dev -- -p 3002`)**

Verify the complete flow:
1. `/dashboards` — create "Growth", appears in list.
2. Open it — "Add widget" → "Ask the agent" → "production MAU" → preview renders → "Add to dashboard" → KPI widget appears; reload → still there.
3. "Add widget" → "Ask the agent" → "signups per day last 14 days" → chart widget; switch its render kind to table in edit mode.
4. Add a text note widget.
5. Edit mode: drag to reorder, change a size to Full → reload → order + size persist.
6. Per-widget refresh + "Refresh all" update the freshness line.
7. Chat (`/agent`): ask a question → "Add to dashboard" → pin to "Growth" → "View dashboard →" shows it.
8. Mobile width (DevTools narrow): grid collapses to one column.
9. Delete a dashboard from `/dashboards` — disappears.

- [ ] **Step 3: Dispatch the final code reviewer** (subagent-driven-development final review), then use **superpowers:finishing-a-development-branch**.

For finishing, follow the project's merge rule from prior work: open/complete the merge to `main` as appropriate for this repo and push both remotes (origin = FlywheelStudio, mohn93). Update the memory file `project_pm_query_agent.md` with a v4 note (dashboards: tables, hybrid widgets, create-with-LLM/refresh-without-LLM, `@dnd-kit`, both creation surfaces).

---

## Notes for the implementer

- **Import DAG (acyclic):** `types.ts` → `widgets.ts` (imports `deriveTitle` from `conversations.ts`, which only imports `message.ts`/`types.ts`) → `dashboards.ts` → routes/hooks → components → pages. Don't import a hook/route from `widgets.ts`.
- **`new Date().toISOString()` in store code is fine** — that prohibition only applies to Workflow scripts, not app code.
- **Stored `sql` is the raw generated SELECT** (what the chat emits as the `sql` event), not the wrapped/limited form. `refreshWidget` re-runs it through `validateSelect` (which re-wraps + re-limits), exactly as the agent loop does — so refresh and original execution are consistent.
- **`widgets(count)` embedded aggregate** requires the FK from `widgets.dashboard_id` → `dashboards.id` (created in Task 1). If PostgREST can't resolve the embed, fall back to a second query counting widgets grouped by dashboard_id — but the FK makes the embed work.
- **Radix popover/select are already installed** (`@radix-ui/react-popover`, `@radix-ui/react-select`); only `@dnd-kit/*` is new.
```
