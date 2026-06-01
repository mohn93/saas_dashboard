export interface ChartSpec {
  type: "bar" | "line" | "area" | "none";
  xColumn: string | null;
  yColumn: string | null;
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
  sql: string;
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
