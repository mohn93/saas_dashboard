import { deriveTitle } from "./conversations";
import { ValidationError } from "./errors";
import {
  CHART_TYPES,
  DISPLAY_MODES,
  WIDGET_KINDS,
  WIDGET_SIZES,
} from "./types";
import type { AgentAnswer, ChartSpec, ChartType, DisplayMode, QueryResult, WidgetKind, WidgetSize } from "./types";

// Build the AgentAnswer shape ResultView consumes from raw parts. One place so
// the chat message + pinned-widget callers can't drift on the literal fields.
export function buildAnswer(parts: {
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
}): AgentAnswer {
  return { ok: true, sql: parts.sql, chart: parts.chart, result: parts.result, error: null };
}

export const STALE_MS = 5 * 60_000; // auto-refresh widgets whose cache is older than 5 min
// Cap rows stored in cached_result. Matches the agent's SQL LIMIT (validate.ts)
// so a pinned widget can paginate through the same full result the chat showed.
export const MAX_CACHED_ROWS = 1000;

export interface WidgetCreateInput {
  kind: WidgetKind;
  title: string;
  size: WidgetSize;
  display: DisplayMode;
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
  display?: DisplayMode;
  chart?: ChartSpec | null;
  textMd?: string | null;
  position?: number;
  // "edit query" replaces the underlying query + resets the cache:
  question?: string | null;
  sql?: string | null;
  result?: QueryResult | null;
}

// ----- runtime validation at the API trust boundary -----
// The route handlers receive arbitrary JSON; the TS interfaces above are
// compile-time only. These parsers validate against the shared unions and
// throw ValidationError (-> 400) so a client can't store bogus kind/size/
// display/chart values that the DB CHECK constraints would also reject.

function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new ValidationError(`${field} must be a string or null`);
}

function parseChartSpec(value: unknown): ChartSpec | null {
  if (value == null) return null;
  if (typeof value !== "object") throw new ValidationError("chart must be an object or null");
  const c = value as Record<string, unknown>;
  return {
    type: asEnum(c.type, CHART_TYPES, "chart.type"),
    xColumn: parseNullableString(c.xColumn, "chart.xColumn"),
    yColumn: parseNullableString(c.yColumn, "chart.yColumn"),
  };
}

function parseQueryResult(value: unknown): QueryResult | null {
  if (value == null) return null;
  if (typeof value !== "object") throw new ValidationError("result must be an object or null");
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.columns) || !r.columns.every((c) => typeof c === "string"))
    throw new ValidationError("result.columns must be string[]");
  if (!Array.isArray(r.rows)) throw new ValidationError("result.rows must be an array");
  if (typeof r.rowCount !== "number") throw new ValidationError("result.rowCount must be a number");
  return {
    columns: r.columns as string[],
    rows: r.rows as Record<string, unknown>[],
    rowCount: r.rowCount,
  };
}

export function parseWidgetCreate(body: unknown): WidgetCreateInput {
  if (!body || typeof body !== "object") throw new ValidationError("body must be an object");
  const b = body as Record<string, unknown>;
  if (typeof b.title !== "string" || !b.title.trim()) throw new ValidationError("title is required");
  return {
    kind: asEnum(b.kind, WIDGET_KINDS, "kind"),
    title: b.title,
    size: asEnum(b.size, WIDGET_SIZES, "size"),
    display: b.display == null ? "both" : asEnum(b.display, DISPLAY_MODES, "display"),
    question: parseNullableString(b.question, "question"),
    sql: parseNullableString(b.sql, "sql"),
    chart: parseChartSpec(b.chart),
    result: parseQueryResult(b.result),
    textMd: parseNullableString(b.textMd, "textMd"),
  };
}

export function parseWidgetPatch(body: unknown): WidgetPatch {
  if (!body || typeof body !== "object") throw new ValidationError("body must be an object");
  const b = body as Record<string, unknown>;
  const patch: WidgetPatch = {};
  if ("title" in b) {
    if (typeof b.title !== "string") throw new ValidationError("title must be a string");
    patch.title = b.title;
  }
  if ("size" in b) patch.size = asEnum(b.size, WIDGET_SIZES, "size");
  if ("kind" in b) patch.kind = asEnum(b.kind, WIDGET_KINDS, "kind");
  if ("display" in b) patch.display = asEnum(b.display, DISPLAY_MODES, "display");
  if ("chart" in b) patch.chart = parseChartSpec(b.chart);
  if ("textMd" in b) patch.textMd = parseNullableString(b.textMd, "textMd");
  if ("position" in b) {
    if (typeof b.position !== "number" || !Number.isInteger(b.position))
      throw new ValidationError("position must be an integer");
    patch.position = b.position;
  }
  if ("question" in b) patch.question = parseNullableString(b.question, "question");
  if ("sql" in b) patch.sql = parseNullableString(b.sql, "sql");
  if ("result" in b) patch.result = parseQueryResult(b.result);
  return patch;
}

export function isNumericCell(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

// A single-cell numeric result that should render as a KPI tile. The one
// definition shared by deriveWidgetKind (auto path) and pickInitialKind
// (picker-default path) so the two can't drift.
export function isKpiResult(result: QueryResult | null): boolean {
  return (
    !!result &&
    result.rows.length === 1 &&
    result.columns.length === 1 &&
    isNumericCell(result.rows[0][result.columns[0]])
  );
}

// Whether a ChartSpec is actually renderable (real type + both axes). The one
// definition shared by deriveWidgetKind, canPickChart, resolveWidgetChart, and
// the ResultView render guard so "can pick a chart" and "can draw a chart"
// never disagree.
export function hasUsableChart(
  chart: ChartSpec | null
): chart is ChartSpec & { xColumn: string; yColumn: string } {
  return !!(chart && chart.type !== "none" && chart.xColumn && chart.yColumn);
}

export function deriveWidgetKind(
  result: QueryResult | null,
  chart: ChartSpec | null
): WidgetKind {
  if (!result) return "table";
  if (isKpiResult(result)) return "kpi";
  if (hasUsableChart(chart)) return "chart";
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
  display?: DisplayMode;
}): WidgetCreateInput {
  const kind = input.kind ?? deriveWidgetKind(input.result, input.chart);
  // Only chart widgets carry a chart/both display; table & kpi always render as a table.
  const display: DisplayMode = kind === "chart" ? input.display ?? "both" : "table";
  return {
    kind,
    title: input.title?.trim() || deriveTitle(input.question),
    size: input.size ?? "md",
    display,
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
  return canChart(result) || hasUsableChart(chart);
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

// Default widget kind for the add-to-dashboard picker, from the answer + the agent's display.
export function pickInitialKind(
  result: QueryResult | null,
  chart: ChartSpec | null,
  display: DisplayMode
): WidgetKind {
  if (isKpiResult(result)) return "kpi";
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
