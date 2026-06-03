import { deriveTitle } from "./conversations";
import type { ChartSpec, ChartType, DisplayMode, QueryResult, WidgetKind, WidgetSize } from "./types";

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

// Whether the add-to-dashboard picker should ENABLE the Chart option: either the result is
// inferrably chartable, or the answer already carries chart axes. Kept in lock-step with the
// chart branch of pickInitialKind so the picker's enabled state and its default never diverge.
export function canPickChart(result: QueryResult | null, chart: ChartSpec | null): boolean {
  return canChart(result) || !!(chart && chart.xColumn && chart.yColumn);
}

// Default chart type for the picker: the answer's own chart type if set, else "bar".
export function initialChartType(chart: ChartSpec | null): ChartType {
  return chart && chart.type !== "none" ? chart.type : "bar";
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
