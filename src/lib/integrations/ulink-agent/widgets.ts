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
