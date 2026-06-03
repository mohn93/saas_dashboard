# Presentation Control — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Project:** `flywheel_saas_dashboard` (Flywheel Command Center) — PM Data Agent

## Problem

Two gaps in how query results are presented:

1. **The agent can't choose table vs chart.** Today a result *always* renders a table, plus a
   chart whenever a chart spec is present. The orchestrator can pick the chart *type* (the
   `chart` arg) but can't say "show this as a chart" or "just a table" — so it can't give a
   clean chart-only answer, and tables show even when redundant.
2. **No control when adding to a dashboard.** Pinning (from chat) or composing in place
   auto-derives the widget kind from what the model returned. There's no picker to choose
   Table / Chart / KPI (or the chart type) at add-time, and a plain-table answer can't be
   turned into a chart at all (no chart spec/axes).

## Decisions (locked during brainstorming)

- **Chat presentation is a mode the agent picks per answer:** `display` ∈ `table | chart |
  both`. `chart` shows the chart with the full table **collapsed under a "Show table"
  toggle** (data never lost); `table` shows only the table; `both` shows chart + full table.
- **Default is table-only.** When the agent specifies no `display` (and gives no chart
  type), the answer shows **just the table** — charts never appear automatically.
- **Convenience:** if the agent passes a `chart` *type* but omits `display`, `display` is
  treated as `chart` (so `query(…, chart:"pie")` shows a pie without also setting `display`).
- **Dashboard add gets a picker:** both add paths let the user choose render-kind (Table /
  Chart / KPI) and, for Chart, the chart type — defaulting from the answer + the agent's
  `display` hint.
- **Axis inference:** at add-time, a chartable table (one label column + one numeric column)
  can become a chart even when the agent left it table-only, by inferring x/y. Non-chartable
  shapes disable the Chart option.
- **`generateSql` (R1) is unchanged** — it still computes the chart spec/axes; `display` is a
  presentation choice applied in the tool/UI layer, not by R1.
- **Dashboard widget rendering is unchanged** (its `kind` already drives chart-vs-table; its
  edit-mode toggles already work, now including pie).

## Architecture

`display` is a per-answer presentation property that flows: orchestrator → `query` tool →
the `result` AgentEvent → the reduced `AgentMessage` → `ResultView`. It is chat-only;
dashboards use the widget's existing `kind`. The add-picker reuses `widgetFromAnswer`
(which already accepts an explicit `kind`) plus a new pure `inferChartSpec` helper.

### 1. Types

In `src/lib/integrations/ulink-agent/types.ts`:
```ts
export type DisplayMode = "table" | "chart" | "both";
```
- `AgentAnswer` gains `display?: DisplayMode` (optional; consumers default to `"both"` for
  back-compat with already-persisted answers that have no `display`).

In `src/lib/integrations/ulink-agent/events.ts`: the `result` event gains `display: DisplayMode`.

In `src/lib/integrations/ulink-agent/message.ts`: `AgentMessage` gains `display: DisplayMode`
(default `"both"` in `emptyMessage` for back-compat); `applyEvent`'s `result` case sets
`display` from the event.

### 2. Agent control (the `display` arg)

In `agent-tools.ts`, the `query` tool definition gains an optional `display` enum param
(`table | chart | both`) alongside the existing `chart` (type) param. `dispatchTool`
extracts and validates it (invalid → undefined), and passes it to `runQuery`.

`runQuery` resolves the effective display once, before emitting the `result` event:
```ts
const effectiveDisplay: DisplayMode =
  display ?? (chartHint && chartHint !== "none" ? "chart" : "table");
```
and includes `display: effectiveDisplay` on the emitted `result` event. (`generateSql` still
produces `gen.chart`; the chart spec is emitted as today, but only *rendered* per `display`.)

`buildSystemPrompt` (loop.ts) gains a rule: *"Results show as a table by default. When a
chart genuinely helps (a breakdown, share, or trend), set `display` to `chart` (or `both`)
and optionally a chart type. Don't chart tiny or non-aggregated results."*

### 3. Chat rendering

`ResultView` accepts an optional `display?: DisplayMode` prop (default `"both"`):
- `table` → render the table only; no chart (even if `answer.chart` is set).
- `chart` → render the chart; the table is wrapped in a collapsed **"Show table ▸ / Hide
  table ▾"** section (reusing the existing expand/collapse interaction style), so the data
  is one click away.
- `both` → chart (if a usable spec) + full table — today's layout.

`agent-message.tsx` passes `message.display` to `ResultView`. Persistence is automatic: the
`AgentMessage` payload (JSONB) round-trips `display`, so reopened chats render the same way.
No DB schema change.

### 4. Dashboard add-picker

Both add surfaces get a picker step before saving:

- **`PinToDashboard`** (chat → popover) and **`AddWidgetComposer`** (in-place → "Add to
  dashboard" step).
- **Controls:** a render-kind selector (Table / Chart / KPI). When **Chart** is selected, a
  chart-type selector (bar / line / area / pie) appears.
- **Default selection** comes from the answer + the agent's `display`:
  - `display` is `chart`/`both` and the answer has a usable chart → **Chart** + that type.
  - result is 1×1 numeric → **KPI**.
  - otherwise → **Table**.
- **Axis inference** via a new pure helper `inferChartSpec(result, type?)` in `widgets.ts`:
  - `canChart(result)`: true when the result has ≥1 row and exactly one numeric column plus
    at least one non-numeric (label) column (or 2 columns, one numeric).
  - `inferChartSpec(result, type = "bar")`: returns `{ type, xColumn: <label col>, yColumn:
    <numeric col> }` when chartable, else `null`.
  - If the user picks Chart and the answer already has a usable `chart` spec, use it (with
    the user's chosen type); otherwise infer. If not chartable, the **Chart option is
    disabled** with a hint ("needs a label + a numeric column").
- The chosen `kind` and resolved chart spec are passed to `widgetFromAnswer({ …, kind,
  chart })` → `createWidget`, so the widget stores the correct `kind` + `chart_spec`.

### 5. Pure helpers (`widgets.ts`)

```ts
export function canChart(result: QueryResult | null): boolean;
export function inferChartSpec(result: QueryResult | null, type?: ChartType): ChartSpec | null;
```
Reuses the existing `isNumericCell` logic (already in `widgets.ts`). `ChartType`/`ChartSpec`
come from `types.ts` (the single source of truth added earlier).

## Error handling

- A `display` value the model didn't recognize → treated as undefined → falls back to the
  default resolution (table, or chart when a chart type was given). Never throws.
- `inferChartSpec` returns `null` for non-chartable shapes; the picker disables Chart rather
  than producing a broken/empty chart.
- Persisted messages without a `display` field → default `"both"` (preserves how existing
  saved chats already render). New answers always carry `display`.
- All existing read-only / persistence / dashboard guarantees are unchanged.

## Testing (Vitest, pure logic — matching repo convention)

- `canChart`: chartable (label + numeric) → true; all-text or no-numeric → false; null/empty
  → false.
- `inferChartSpec`: 2-column (label + numeric) → `{type, xColumn, yColumn}`; honors a passed
  `type`; non-chartable → `null`.
- `dispatchTool`/`runQuery`: a `query` with `display:"chart"` emits a `result` event whose
  `display` is `"chart"`; with only `chart:"pie"` (no display) → emitted `display` is
  `"chart"`; with neither → `"table"`.
- Existing `applyEvent` test extended: a `result` event sets `message.display`.
- ResultView / pin / composer remain untested (repo convention); verified via build + smoke.

## Out of scope (YAGNI)

- Changing how dashboard widgets render chart-vs-table (the widget `kind` already governs it).
- Multi-result turns / multiple charts per answer.
- A user-facing display switcher in chat beyond the "Show table" collapse.
- Any DB/memory schema change (display rides in the existing JSONB payload).

## Files

- **Modify:** `src/lib/integrations/ulink-agent/types.ts` (`DisplayMode`; `AgentAnswer.display`).
- **Modify:** `src/lib/integrations/ulink-agent/events.ts` (`result` event `display`).
- **Modify:** `src/lib/integrations/ulink-agent/message.ts` (`AgentMessage.display`, `applyEvent`).
- **Modify:** `src/lib/integrations/ulink-agent/widgets.ts` (`canChart`, `inferChartSpec`) + test.
- **Modify:** `src/lib/integrations/ulink-agent/agent-tools.ts` (`display` arg, resolve + emit) + test.
- **Modify:** `src/lib/integrations/ulink-agent/loop.ts` (`buildSystemPrompt` display rule).
- **Modify:** `src/components/agent/result-view.tsx` (`display` prop + table collapse).
- **Modify:** `src/components/agent/agent-message.tsx` (pass `message.display`).
- **Modify:** `src/components/agent/pin-to-dashboard.tsx` (kind/chart-type picker + inference).
- **Modify:** `src/components/dashboard-builder/add-widget-composer.tsx` (same picker).
- **Unchanged:** dashboard widget rendering, persistence/store, memory schema, route.
