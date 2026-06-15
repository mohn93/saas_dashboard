export const CHART_TYPES = ["bar", "line", "area", "pie", "none"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// The chart types a user can actually pick in the UI (everything except the
// sentinel "none"). Derived from CHART_TYPES so the pickers can never drift
// from the canonical list / the agent tool enum / the render switch.
export const SELECTABLE_CHART_TYPES = CHART_TYPES.filter(
  (t): t is Exclude<ChartType, "none"> => t !== "none"
);

export interface ChartSpec {
  type: ChartType;
  xColumn: string | null; // label/category column
  yColumn: string | null; // numeric value column
}

export const DISPLAY_MODES = ["table", "chart", "both"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export interface CatalogColumn {
  table: string;
  column: string;
  dataType: string;
  isNullable: boolean;
  description: string | null;
}

export interface CatalogForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface TableSummary {
  table: string;
  description: string | null;
}

export interface AgentExample {
  question: string;
  sql: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ConversationTurn {
  question: string;
  sql: string | null;
  ok: boolean;
  error: string | null;
  answer?: string | null; // the assistant's prior reply/narration, so the agent sees its own thread
}

// The shape ResultView consumes. Built from a chat message (agent-message) or a
// pinned widget (widget-body) via buildAnswer(). Carries only what ResultView
// reads — the per-message logId lives on AgentMessage and is used directly.
export interface AgentAnswer {
  ok: boolean;
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  error: string | null;
}

export interface QueryLogEntry {
  question: string;
  sql: string | null;
  attempts: number;
  rowCount: number | null;
  success: boolean;
  error: string | null;
  userEmail: string | null;
  estCost?: number | null;
  estRows?: number | null;
}

export interface MemoryStore {
  getTableSummaries(): Promise<TableSummary[]>;
  getColumnsForTables(tables: string[]): Promise<CatalogColumn[]>;
  getForeignKeysForTables(tables: string[]): Promise<CatalogForeignKey[]>;
  getTrustedExamples(): Promise<AgentExample[]>;
  insertQueryLog(entry: QueryLogEntry): Promise<string>;
  promoteLogToExample(logId: string): Promise<void>;
  replaceCatalog(input: {
    tables: string[];
    columns: CatalogColumn[];
    foreignKeys: CatalogForeignKey[];
  }): Promise<void>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdByEmail: string | null;
  updatedAt: string;
}

export const WIDGET_KINDS = ["chart", "table", "kpi", "text"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export const WIDGET_SIZES = ["sm", "md", "full"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

// User-selectable widget kinds in their canonical picker order (excludes the
// internal "text" note kind). Single source for both the add/pin picker and the
// inline editor so the segmented control can't reorder between the two surfaces.
export const SELECTABLE_WIDGET_KINDS: Exclude<WidgetKind, "text">[] = ["table", "chart", "kpi"];

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
  display: DisplayMode; // how the cached result is presented (chart collapses the table)
  result: QueryResult | null; // from cached_result
  cachedAt: string | null;
  textMd: string | null;
  createdByEmail: string | null;
  refreshError?: boolean; // transient client-only: last refresh failed, showing cached
}

export interface DashboardSummary {
  id: string;
  name: string;
  widgetCount: number;
  createdByEmail: string | null;
  updatedAt: string;
}
