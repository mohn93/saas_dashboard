export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "none";
  xColumn: string | null; // label/category column
  yColumn: string | null; // numeric value column
}

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

export interface AgentAnswer {
  ok: boolean;
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  error: string | null;
  attempts: number;
  logId: string | null;
}

export interface QueryLogEntry {
  question: string;
  sql: string | null;
  attempts: number;
  rowCount: number | null;
  success: boolean;
  error: string | null;
  userEmail: string | null;
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
  refreshError?: boolean; // transient client-only: last refresh failed, showing cached
}

export interface DashboardSummary {
  id: string;
  name: string;
  widgetCount: number;
  createdByEmail: string | null;
  updatedAt: string;
}
