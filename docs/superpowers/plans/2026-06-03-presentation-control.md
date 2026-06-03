# Presentation Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent choose how a result is presented in chat (table / chart / both, default table-only), and let the user choose render-kind + chart-type when adding a result to a dashboard (with axis inference so any chartable table can become a chart).

**Architecture:** A `display` mode (`table|chart|both`) is set by the orchestrator on the `query` tool, carried on the `result` event → reduced into the `AgentMessage` → honored by `ResultView` (chat-only; dashboards keep their widget `kind`). The dashboard add flow (pin popover + in-place composer) gets a render-kind/chart-type picker backed by new pure helpers (`canChart`, `inferChartSpec`, `pickInitialKind`, `resolveWidgetChart`).

**Tech Stack:** Next.js 14 + TypeScript, DeepSeek tool-calling agent, Tremor charts, Vitest.

---

## Conventions (read first)

- **Branch:** `feat/presentation-control` (Task 1 creates it; never commit to `main`).
- **Test command:** `npx vitest run <file>`. Typecheck: `npx tsc --noEmit`. **Do NOT run `npm run build`** — a dev server is live on :3002 and a prod build clobbers its `.next`. (Controller runs the final build after stopping the dev server.)
- **Testing scope:** pure logic + the tool/reducer layer are unit-tested (mocked clients, like `agent-tools.test.ts`). React components (`ResultView`, the picker, pin/composer) are NOT unit-tested — verify with `npx tsc --noEmit` + the smoke steps.
- **Never `git add -A`** — a stray `._fix2.cjs` must never be staged. Add exact paths.
- `ChartType`/`ChartSpec`/`CHART_TYPES` already live in `types.ts` (single source of truth). `WidgetKind = "chart"|"table"|"kpi"|"text"`. `isNumericCell` already exists in `widgets.ts`.

---

## File structure

- `types.ts` *(modify)* — add `DisplayMode`.
- `events.ts` *(modify)* — `result` event gains `display`.
- `message.ts` *(modify)* — `AgentMessage.display` + reducer + default.
- `widgets.ts` *(modify)* — pure helpers `chartColumns`/`canChart`/`inferChartSpec`/`pickInitialKind`/`resolveWidgetChart`.
- `agent-tools.ts` *(modify)* — `query` tool `display` arg; resolve + emit on `result`.
- `loop.ts` *(modify)* — system-prompt display rule.
- `result-view.tsx` *(modify)* — `display` prop + table collapse.
- `agent-message.tsx` *(modify)* — pass `message.display`.
- `widget-kind-picker.tsx` *(new)* — render-kind + chart-type selector.
- `pin-to-dashboard.tsx` *(modify)* — picker + inference.
- `add-widget-composer.tsx` *(modify)* — picker + inference + live preview.

---

## Task 1: `display` types, event, and message reducer

**Files:**
- Modify: `src/lib/integrations/ulink-agent/types.ts`
- Modify: `src/lib/integrations/ulink-agent/events.ts`
- Modify: `src/lib/integrations/ulink-agent/message.ts`
- Test: `src/lib/integrations/ulink-agent/message.test.ts`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
git checkout main && git checkout -b feat/presentation-control
```

- [ ] **Step 2: Add `DisplayMode` to `types.ts`**

Immediately after the `ChartSpec` interface (and the `CHART_TYPES`/`ChartType` block) in `src/lib/integrations/ulink-agent/types.ts`, add:

```ts
export type DisplayMode = "table" | "chart" | "both";
```

- [ ] **Step 3: Add `display` to the `result` event**

In `src/lib/integrations/ulink-agent/events.ts`, add `DisplayMode` to the type import from `./types` (it currently imports `ChartSpec`), then add a `display` field to the `result` member of the `AgentEvent` union:

```ts
import type { ChartSpec, DisplayMode } from "./types";
```
```ts
  | {
      type: "result";
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      chart: ChartSpec | null;
      display: DisplayMode;
    }
```

- [ ] **Step 4: Write the failing reducer test**

In `src/lib/integrations/ulink-agent/message.test.ts`, add this test inside the existing `describe("applyEvent", …)` block (import `DisplayMode` is not needed — the literal is enough):

```ts
  it("sets display from a result event", () => {
    const m = applyEvent(emptyMessage("m1", "q"), {
      type: "result",
      columns: ["n"],
      rows: [{ n: 5 }],
      rowCount: 1,
      chart: null,
      display: "chart",
    });
    expect(m.display).toBe("chart");
    expect(m.result?.rowCount).toBe(1);
  });

  it("defaults display to 'both' on a fresh message", () => {
    expect(emptyMessage("m1", "q").display).toBe("both");
  });
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/message.test.ts`
Expected: FAIL — `display` doesn't exist on `AgentMessage` / `emptyMessage`.

- [ ] **Step 6: Add `display` to `AgentMessage`, `emptyMessage`, and `applyEvent`**

In `src/lib/integrations/ulink-agent/message.ts`:

Add `DisplayMode` to the type import from `./types`:
```ts
import type { ChartSpec, DisplayMode, QueryResult } from "./types";
```

Add the field to the `AgentMessage` interface (after `result: QueryResult | null;`):
```ts
  display: DisplayMode;
```

Add it to `emptyMessage`'s returned object (after `result: null,`):
```ts
    display: "both",
```

Update the `applyEvent` `result` case to carry `display`:
```ts
    case "result":
      return {
        ...m,
        result: { columns: e.columns, rows: e.rows, rowCount: e.rowCount },
        chart: e.chart,
        display: e.display,
      };
```

- [ ] **Step 7: Run the test + typecheck**

Run: `npx vitest run src/lib/integrations/ulink-agent/message.test.ts` → PASS.
Run: `npx tsc --noEmit` → expect errors ONLY where the `result` event is emitted without `display` yet (`agent-tools.ts`) — that's fixed in Task 3. Confirm no other files error. (If `agent-tools.ts` is the only error, proceed.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/integrations/ulink-agent/types.ts src/lib/integrations/ulink-agent/events.ts src/lib/integrations/ulink-agent/message.ts src/lib/integrations/ulink-agent/message.test.ts
git commit -m "feat(agent): DisplayMode on result event + AgentMessage"
```

---

## Task 2: pure chart/kind helpers in `widgets.ts`

**Files:**
- Modify: `src/lib/integrations/ulink-agent/widgets.ts`
- Test: `src/lib/integrations/ulink-agent/widgets.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/integrations/ulink-agent/widgets.test.ts` (add `canChart, inferChartSpec, pickInitialKind, resolveWidgetChart` to the existing import from `./widgets`):

```ts
describe("canChart / inferChartSpec", () => {
  const chartable: QueryResult = {
    columns: ["month", "n"],
    rows: [{ month: "2026-04", n: 4 }, { month: "2026-05", n: 2 }],
    rowCount: 2,
  };
  const allText: QueryResult = {
    columns: ["a", "b"],
    rows: [{ a: "x", b: "y" }],
    rowCount: 1,
  };

  it("canChart true for a label + numeric column", () => {
    expect(canChart(chartable)).toBe(true);
  });
  it("canChart false for all-text or null/empty", () => {
    expect(canChart(allText)).toBe(false);
    expect(canChart(null)).toBe(false);
    expect(canChart({ columns: ["n"], rows: [], rowCount: 0 })).toBe(false);
  });
  it("inferChartSpec picks label x + numeric y, default bar", () => {
    expect(inferChartSpec(chartable)).toEqual({ type: "bar", xColumn: "month", yColumn: "n" });
  });
  it("inferChartSpec honors a passed type", () => {
    expect(inferChartSpec(chartable, "pie")).toEqual({ type: "pie", xColumn: "month", yColumn: "n" });
  });
  it("inferChartSpec returns null when not chartable", () => {
    expect(inferChartSpec(allText)).toBeNull();
  });
});

describe("pickInitialKind", () => {
  const oneByOne: QueryResult = { columns: ["mau"], rows: [{ mau: 5 }], rowCount: 1 };
  const series: QueryResult = {
    columns: ["m", "n"],
    rows: [{ m: "a", n: 1 }],
    rowCount: 1,
  };
  const usableChart = { type: "pie" as const, xColumn: "m", yColumn: "n" };

  it("returns kpi for a 1x1 numeric result", () => {
    expect(pickInitialKind(oneByOne, null, "both")).toBe("kpi");
  });
  it("returns chart when display is chart/both and chartable", () => {
    expect(pickInitialKind(series, null, "chart")).toBe("chart");
    expect(pickInitialKind(series, usableChart, "both")).toBe("chart");
  });
  it("returns table when display is table even if chartable", () => {
    expect(pickInitialKind(series, usableChart, "table")).toBe("table");
  });
});

describe("resolveWidgetChart", () => {
  const series: QueryResult = { columns: ["m", "n"], rows: [{ m: "a", n: 1 }], rowCount: 1 };
  it("forces the chosen type onto an existing usable chart", () => {
    const base = { type: "bar" as const, xColumn: "m", yColumn: "n" };
    expect(resolveWidgetChart(series, base, "chart", "pie")).toEqual({ type: "pie", xColumn: "m", yColumn: "n" });
  });
  it("infers a chart when there is no usable base chart", () => {
    expect(resolveWidgetChart(series, null, "chart", "line")).toEqual({ type: "line", xColumn: "m", yColumn: "n" });
  });
  it("returns the base chart unchanged for non-chart kinds", () => {
    const base = { type: "bar" as const, xColumn: "m", yColumn: "n" };
    expect(resolveWidgetChart(series, base, "table", "pie")).toBe(base);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/widgets.test.ts`
Expected: FAIL — these functions aren't exported yet.

- [ ] **Step 3: Implement the helpers**

In `src/lib/integrations/ulink-agent/widgets.ts`, update the type import to include `ChartType` and `DisplayMode`:
```ts
import type { ChartSpec, ChartType, DisplayMode, QueryResult, WidgetKind, WidgetSize } from "./types";
```

Then append these exports (they reuse the existing `isNumericCell`):
```ts
// Find a (label, value) column pair for charting: a numeric column + a different column.
function chartColumns(result: QueryResult | null): { label: string; value: string } | null {
  if (!result || result.rows.length === 0 || result.columns.length < 2) return null;
  const first = result.rows[0];
  const value = result.columns.find((c) => isNumericCell(first[c]));
  if (!value) return null;
  const label =
    result.columns.find((c) => c !== value && !isNumericCell(first[c])) ??
    result.columns.find((c) => c !== value);
  if (!label) return null;
  return { label, value };
}

export function canChart(result: QueryResult | null): boolean {
  return chartColumns(result) !== null;
}

export function inferChartSpec(
  result: QueryResult | null,
  type: ChartType = "bar"
): ChartSpec | null {
  const cols = chartColumns(result);
  if (!cols) return null;
  return { type, xColumn: cols.label, yColumn: cols.value };
}

function hasUsableChart(chart: ChartSpec | null): boolean {
  return !!(chart && chart.type !== "none" && chart.xColumn && chart.yColumn);
}

// Default widget kind for the add-to-dashboard picker, from the answer + the agent's display.
export function pickInitialKind(
  result: QueryResult | null,
  chart: ChartSpec | null,
  display: DisplayMode
): WidgetKind {
  if (
    result &&
    result.rows.length === 1 &&
    result.columns.length === 1 &&
    isNumericCell(result.rows[0][result.columns[0]])
  ) {
    return "kpi";
  }
  if ((display === "chart" || display === "both") && (hasUsableChart(chart) || canChart(result))) {
    return "chart";
  }
  return "table";
}

// The chart spec to store for a chosen widget kind: for "chart", force the chosen type onto
// the model's axes (or infer them); for table/kpi, leave the base chart as-is (render ignores it).
export function resolveWidgetChart(
  result: QueryResult | null,
  baseChart: ChartSpec | null,
  kind: WidgetKind,
  chartType: ChartType
): ChartSpec | null {
  if (kind !== "chart") return baseChart;
  if (hasUsableChart(baseChart)) return { ...(baseChart as ChartSpec), type: chartType };
  return inferChartSpec(result, chartType);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/widgets.test.ts` → PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (still only the `agent-tools.ts` result-event error from Task 1 — fixed in Task 3).

```bash
git add src/lib/integrations/ulink-agent/widgets.ts src/lib/integrations/ulink-agent/widgets.test.ts
git commit -m "feat(agent): chart/kind helpers (canChart, inferChartSpec, pickInitialKind, resolveWidgetChart)"
```

---

## Task 3: `display` arg on the `query` tool

**Files:**
- Modify: `src/lib/integrations/ulink-agent/agent-tools.ts`
- Test: `src/lib/integrations/ulink-agent/agent-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/integrations/ulink-agent/agent-tools.test.ts`, inside `describe("dispatchTool: query", …)`, add (these use the existing `reasonerReturning`/`ctxWith`/`fakeMemory` helpers, where `reasonerReturning` yields a `chart:{type:"none",…}`):

```ts
  it("emits display='table' by default", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("table");
  });

  it("emits display='chart' when display arg is chart", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q", display: "chart" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("chart");
  });

  it("treats a chart type with no display as display='chart'", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q", chart: "pie" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("chart");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/agent-tools.test.ts`
Expected: FAIL — the `result` event has no `display`.

- [ ] **Step 3: Implement the `display` arg**

In `src/lib/integrations/ulink-agent/agent-tools.ts`:

Add `DisplayMode` to the type import:
```ts
import type { ChartSpec, DisplayMode, MemoryStore, QueryResult } from "./types";
```

Add a `display` property to the `query` tool's `parameters.properties` (after `chart`):
```ts
          display: {
            type: "string",
            enum: ["table", "chart", "both"],
            description:
              "How to present the result to the user. 'table' (default) shows just the table; " +
              "'chart' shows the chart with the table collapsed; 'both' shows chart + table. " +
              "Set 'chart' or 'both' only when a chart genuinely helps.",
          },
```

Change `runQuery`'s signature to take the display and pass it on the `result` event. Replace the signature:
```ts
async function runQuery(
  question: string,
  ctx: ToolContext,
  chartHint?: ChartSpec["type"],
  display: DisplayMode = "table"
): Promise<ToolOutcome> {
```
and the `result` emit (add `display`):
```ts
  ctx.emit({
    type: "result",
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    chart: gen.chart,
    display,
  });
```

In `dispatchTool`, extend the parsed args type and resolve the effective display, then pass it to `runQuery`. Replace the args block + the query dispatch:
```ts
  let args: { question?: unknown; chart?: unknown; display?: unknown };
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { content: JSON.stringify({ error: `Invalid JSON arguments for ${call.name}` }) };
  }
  const question = typeof args.question === "string" ? args.question.trim() : "";
  const chartHint = CHART_TYPES.includes(args.chart as (typeof CHART_TYPES)[number])
    ? (args.chart as ChartSpec["type"])
    : undefined;
  const DISPLAY_MODES = ["table", "chart", "both"] as const;
  const displayArg = DISPLAY_MODES.includes(args.display as (typeof DISPLAY_MODES)[number])
    ? (args.display as DisplayMode)
    : undefined;
  // Convenience: a chart type with no explicit display means "show a chart".
  const display: DisplayMode = displayArg ?? (chartHint && chartHint !== "none" ? "chart" : "table");

  if (call.name === QUERY_TOOL) {
    if (!question) return { content: JSON.stringify({ error: "query requires a 'question' string" }) };
    return runQuery(question, ctx, chartHint, display);
  }
```

(Leave the `clarify` branch and the rest unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/agent-tools.test.ts` → PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → now CLEAN (exit 0): Task 1's missing-`display` error is resolved.

```bash
git add src/lib/integrations/ulink-agent/agent-tools.ts src/lib/integrations/ulink-agent/agent-tools.test.ts
git commit -m "feat(agent): query tool display arg (table/chart/both, default table)"
```

---

## Task 4: orchestrator display rule in the system prompt

**Files:**
- Modify: `src/lib/integrations/ulink-agent/loop.ts`

No new test (prompt string). Verify with `npx tsc --noEmit` + existing suite.

- [ ] **Step 1: Add the display rule**

In `src/lib/integrations/ulink-agent/loop.ts`, in `buildSystemPrompt`, find the "Charts & tables:" paragraph and replace its first sentence so it states the table-only default and the `display` arg. Replace:

```ts
    "Charts & tables: every `query` result is shown to the user automatically as a TABLE, and as a " +
      "CHART when the data suits it (the tool picks bar / line / area / pie). So you CAN display charts " +
      "and tables — NEVER tell the user you can't, and never send them to a spreadsheet. When they want " +
      "a chart (e.g. a pie chart), run a `query` whose result is chart-friendly: one label column plus " +
      "one numeric column — usually an aggregate like a count or sum grouped by a category or time " +
      "bucket (e.g. cancellations per month). When the user asks for a SPECIFIC chart type, pass it in " +
      "the `query` tool's `chart` argument (e.g. chart: \"pie\") so it is honored — do not rely on " +
      "phrasing alone. Then tell the user the chart and table are shown below.",
```

with:

```ts
    "Charts & tables: a `query` result is shown to the user as a TABLE by default. You CAN also show a " +
      "CHART — set the `query` tool's `display` argument to \"chart\" (chart with the table collapsed) " +
      "or \"both\" (chart + table), and pass a `chart` type (bar/line/area/pie) when the user wants a " +
      "specific one. Charts need chart-friendly data: one label column + one numeric column (usually an " +
      "aggregate like a count/sum grouped by a category or time bucket, e.g. cancellations per month). " +
      "Only ask for a chart when it genuinely helps (a breakdown, share, or trend) — don't chart tiny or " +
      "non-aggregated results. NEVER tell the user you can't show a chart or send them to a spreadsheet.",
```

- [ ] **Step 2: Typecheck + tests + commit**

Run: `npx tsc --noEmit` (clean) and `npx vitest run` (all pass — the loop tests don't assert prompt text).

```bash
git add src/lib/integrations/ulink-agent/loop.ts
git commit -m "feat(agent): system-prompt rule for display modes (table default)"
```

---

## Task 5: `ResultView` honors `display`

**Files:**
- Modify: `src/components/agent/result-view.tsx`
- Modify: `src/components/agent/agent-message.tsx`

No unit test (component). Verify with `npx tsc --noEmit` + smoke.

- [ ] **Step 1: Add the `display` prop + table collapse in `ResultView`**

In `src/components/agent/result-view.tsx`, add the `DisplayMode` import:
```ts
import type { AgentAnswer, DisplayMode } from "@/lib/integrations/ulink-agent/types";
```
(adjust the existing `AgentAnswer` import line to include `DisplayMode`).

Replace the `ResultView` function (from `export function ResultView({ answer }: { answer: AgentAnswer }) {` through its closing `}`) with:

```tsx
export function ResultView({
  answer,
  display = "both",
}: {
  answer: AgentAnswer;
  display?: DisplayMode;
}) {
  const [showSql, setShowSql] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showTable, setShowTable] = useState(display !== "chart");

  if (!answer.ok) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {answer.error || "Something went wrong."}
        {answer.sql && (
          <pre className="mt-2 overflow-x-auto text-xs text-red-200/80">{answer.sql}</pre>
        )}
      </div>
    );
  }

  const result = answer.result!;
  const cappedRows = result.rows.slice(0, MAX_ROWS);
  const visibleRows = expanded ? cappedRows : cappedRows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = cappedRows.length - visibleRows.length;

  const showChart = display !== "table";
  const tableCollapsible = display === "chart";
  const tableVisible = !tableCollapsible || showTable;

  return (
    <div className="space-y-3">
      {showChart && <Chart answer={answer} />}

      {tableCollapsible && (
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="text-xs font-medium text-violet-400 hover:text-violet-300"
        >
          {showTable ? "Hide table" : "Show table"}
        </button>
      )}

      {tableVisible && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row, i) => (
                  <TableRow key={i}>
                    {result.columns.map((c) => (
                      <TableCell key={c}>
                        <TruncatedCell value={row[c]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
              {result.rowCount > MAX_ROWS ? ` (first ${MAX_ROWS} shown)` : ""}
              {!expanded && hiddenCount > 0 ? ` · showing ${visibleRows.length}` : ""}
            </p>
            {cappedRows.length > COLLAPSED_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-xs font-medium text-violet-400 hover:text-violet-300"
              >
                {expanded ? "Show less" : `Show all ${cappedRows.length}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSql((s) => !s)}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {showSql ? "Hide SQL" : "View SQL"}
            </button>
          </div>

          {showSql && (
            <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
              {answer.sql}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass `message.display` from the chat message**

In `src/components/agent/agent-message.tsx`, find where `ResultView` is rendered (currently `{resultAnswer && <ResultView answer={resultAnswer} />}`) and pass the display:

```tsx
      {resultAnswer && <ResultView answer={resultAnswer} display={message.display} />}
```

(`WidgetBody` keeps calling `<ResultView answer={answer} />` with no `display`, so dashboard widgets default to `"both"` — unchanged.)

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (clean).

```bash
git add src/components/agent/result-view.tsx src/components/agent/agent-message.tsx
git commit -m "feat(agent): ResultView honors display (table/chart/both + table collapse)"
```

---

## Task 6: dashboard add-picker (render-kind + chart-type)

**Files:**
- Create: `src/components/dashboard-builder/widget-kind-picker.tsx`
- Modify: `src/components/agent/pin-to-dashboard.tsx`
- Modify: `src/components/dashboard-builder/add-widget-composer.tsx`

No unit test (components). Verify with `npx tsc --noEmit` + smoke.

- [ ] **Step 1: Create the `WidgetKindPicker` component**

Create `src/components/dashboard-builder/widget-kind-picker.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ChartType, WidgetKind } from "@/lib/integrations/ulink-agent/types";

const KINDS: Exclude<WidgetKind, "text">[] = ["table", "chart", "kpi"];
const CHART_TYPES: ChartType[] = ["bar", "line", "area", "pie"];

export function WidgetKindPicker({
  kind,
  chartType,
  chartable,
  onKindChange,
  onChartTypeChange,
}: {
  kind: WidgetKind;
  chartType: ChartType;
  chartable: boolean;
  onKindChange: (k: WidgetKind) => void;
  onChartTypeChange: (t: ChartType) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
        {KINDS.map((k) => {
          const disabled = k === "chart" && !chartable;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onKindChange(k)}
              title={disabled ? "Needs a label + a numeric column" : undefined}
              className={cn(
                "flex-1 px-2 py-1 capitalize",
                kind === k ? "bg-violet-600 text-white" : "hover:bg-accent",
                disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {k}
            </button>
          );
        })}
      </div>
      {kind === "chart" && (
        <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
          {CHART_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChartTypeChange(t)}
              className={cn(
                "flex-1 px-2 py-1 capitalize",
                chartType === t ? "bg-violet-600 text-white" : "hover:bg-accent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the picker into `PinToDashboard`**

Replace the full contents of `src/components/agent/pin-to-dashboard.tsx` with:

```tsx
"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { LayoutDashboard, Plus, Check } from "lucide-react";
import { useDashboards } from "@/hooks/use-dashboards";
import {
  widgetFromAnswer,
  canChart,
  pickInitialKind,
  resolveWidgetChart,
} from "@/lib/integrations/ulink-agent/widgets";
import { WidgetKindPicker } from "@/components/dashboard-builder/widget-kind-picker";
import type { AgentMessage } from "@/lib/integrations/ulink-agent/message";
import type { ChartType, WidgetKind } from "@/lib/integrations/ulink-agent/types";

function initialChartType(message: AgentMessage): ChartType {
  return message.chart && message.chart.type !== "none" ? message.chart.type : "bar";
}

export function PinToDashboard({ message }: { message: AgentMessage }) {
  const { dashboards, create, refresh } = useDashboards({ auto: false });
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<WidgetKind>(() =>
    pickInitialKind(message.result, message.chart, message.display)
  );
  const [chartType, setChartType] = useState<ChartType>(() => initialChartType(message));

  const chartable =
    canChart(message.result) || !!(message.chart && message.chart.xColumn && message.chart.yColumn);

  async function pin(dashboardId: string) {
    setBusy(true);
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      result: message.result,
      kind,
      chart: resolveWidgetChart(message.result, message.chart, kind, chartType),
    });
    try {
      const res = await fetch(`/api/agent/dashboards/${dashboardId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) setSavedTo(dashboardId);
    } finally {
      setBusy(false);
    }
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
        if (o) void refresh();
        else setSavedTo(null);
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
            <div className="space-y-2">
              <div className="px-1">
                <WidgetKindPicker
                  kind={kind}
                  chartType={chartType}
                  chartable={chartable}
                  onKindChange={setKind}
                  onChartTypeChange={setChartType}
                />
              </div>
              <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">Pin to…</p>
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

- [ ] **Step 3: Wire the picker into `AddWidgetComposer`**

In `src/components/dashboard-builder/add-widget-composer.tsx`:

Update imports:
```ts
import { useEffect, useState } from "react";
```
```ts
import {
  widgetFromAnswer,
  canChart,
  pickInitialKind,
  resolveWidgetChart,
} from "@/lib/integrations/ulink-agent/widgets";
import { WidgetKindPicker } from "./widget-kind-picker";
```
```ts
import type { Widget, WidgetKind, WidgetSize, ChartType } from "@/lib/integrations/ulink-agent/types";
```

Add picker state + a default-on-result effect right after the existing `const { message, run, reset } = useAgentCompose();` line:
```ts
  const [kind, setKind] = useState<WidgetKind>("table");
  const [chartType, setChartType] = useState<ChartType>("bar");

  useEffect(() => {
    if (message?.result) {
      setKind(pickInitialKind(message.result, message.chart, message.display));
      setChartType(message.chart && message.chart.type !== "none" ? message.chart.type : "bar");
    }
  }, [message?.result, message?.chart, message?.display]);

  const chartable =
    canChart(message?.result ?? null) ||
    !!(message?.chart && message.chart.xColumn && message.chart.yColumn);
```

In `close()`, also reset the picker:
```ts
  function close() {
    setMode("tile");
    setQuestion("");
    setTitle("");
    setTextBody("");
    setSize("md");
    setKind("table");
    setChartType("bar");
    reset();
  }
```

In `addQueryWidget`, pass the chosen kind + resolved chart:
```ts
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      result: message.result,
      title: title || message.question,
      size,
      kind,
      chart: resolveWidgetChart(message.result, message.chart, kind, chartType),
    });
```

Make `previewWidget` reflect the chosen kind + resolved chart so the preview updates live. Replace the `previewWidget` definition with:
```ts
  const previewWidget: Widget | null = message?.result
    ? {
        id: "preview",
        dashboardId: "",
        kind,
        title: title || message.question,
        position: 0,
        size,
        question: message.question,
        sql: message.sql,
        chart: resolveWidgetChart(message.result, message.chart, kind, chartType),
        result: message.result,
        cachedAt: null,
        textMd: null,
        createdByEmail: null,
      }
    : null;
```

Render the picker in the query "Add to dashboard" row — replace the controls row (the `<div className="flex flex-wrap items-center gap-2">` block that holds the title input + `SizePicker` + Add button) with a stacked layout that includes the picker:
```tsx
          {message && !message.loading && !message.error && message.result && (
            <div className="space-y-2">
              <WidgetKindPicker
                kind={kind}
                chartType={chartType}
                chartable={chartable}
                onKindChange={setKind}
                onChartTypeChange={setChartType}
              />
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
            </div>
          )}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (clean) and `npx vitest run` (all pass).

```bash
git add src/components/dashboard-builder/widget-kind-picker.tsx src/components/agent/pin-to-dashboard.tsx src/components/dashboard-builder/add-widget-composer.tsx
git commit -m "feat(dashboards): render-kind + chart-type picker on add (with axis inference)"
```

---

## Task 7: final verification & finishing

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit` (exit 0) and `npx vitest run` (all suites pass).

- [ ] **Step 2: Manual smoke (controller stops :3002 dev server, runs `npm run build`, restarts dev, signs in)**

1. **Default** — ask a normal data question → only a **table** shows (no auto chart).
2. **Chart on request** — "show cancellations per month as a pie chart" → V3 sets `display`/`chart` → a **pie** renders with a **"Show table"** toggle; expand it → table appears.
3. **Both** — a question where the agent picks `both` → chart + full table.
4. **Pin a chart** — on a chart answer, "Add to dashboard" → picker defaults to **Chart/pie**; pin → dashboard shows the pie.
5. **Pin a table as a chart** — on a plain-table answer that's chartable (label + numeric), open the picker, switch to **Chart** → it's enabled (axis-inferred); pin → renders a chart. On a non-chartable answer (all text), **Chart is disabled** with the tooltip.
6. **Composer** — "Add widget → Ask the agent" → after the result, the picker appears, the preview updates as you switch Table/Chart/type, and Add stores the chosen kind.
7. **Persistence** — reload a chat with a chart-mode answer → it re-renders chart + collapsed table.

- [ ] **Step 3: Final review + finishing**

Dispatch a final code reviewer over `main..feat/presentation-control`, then use **superpowers:finishing-a-development-branch** (merge to `main`, push both remotes origin + mohn93). Update memory `project_pm_query_agent.md` with a note: `display` modes (table default / chart / both) set by the agent via the `query` tool, carried on the result event → AgentMessage → ResultView; dashboard add-picker (kind + chart-type) with `canChart`/`inferChartSpec`/`pickInitialKind`/`resolveWidgetChart`.

---

## Notes for the implementer

- **Import DAG stays acyclic:** `widgets.ts` → `types.ts` (+ `conversations` for `deriveTitle`, unchanged); the picker/pin/composer import helpers from `widgets.ts`. No new cycles.
- **`display` default is `table`** at the tool layer (new answers), but `emptyMessage`/old persisted payloads default to `"both"` and `ResultView`'s prop defaults to `"both"` — so dashboards and already-saved chats are visually unchanged.
- **`generateSql` is untouched** — it still returns a chart spec; the spec is just only *rendered* per `display` (chat) or per the widget `kind` (dashboard).
- **The composer's default-on-result effect** keys on `message?.result`/`chart`/`display`; the result is set once per query, so it initializes the picker once per run (and re-initializes on a new run) without clobbering mid-stream.
- **`new Date()` etc. are fine** in app code.
