import { getULinkClient } from "@/lib/integrations/ulink/client";
import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  MemoryStore,
  QueryLogEntry,
  TableSummary,
} from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

export const supabaseMemory: MemoryStore = {
  async getTableSummaries(): Promise<TableSummary[]> {
    const { data, error } = await db()
      .from("table_catalog")
      .select("table_name, description");
    if (error) throw new Error(`getTableSummaries: ${error.message}`);
    return (data ?? []).map((r) => ({
      table: r.table_name as string,
      description: (r.description as string | null) ?? null,
    }));
  },

  async getColumnsForTables(tables: string[]): Promise<CatalogColumn[]> {
    if (tables.length === 0) return [];
    const { data, error } = await db()
      .from("column_catalog")
      .select("table_name, column_name, data_type, is_nullable, description")
      .in("table_name", tables);
    if (error) throw new Error(`getColumnsForTables: ${error.message}`);
    return (data ?? []).map((r) => ({
      table: r.table_name as string,
      column: r.column_name as string,
      dataType: r.data_type as string,
      isNullable: r.is_nullable as boolean,
      description: (r.description as string | null) ?? null,
    }));
  },

  async getForeignKeysForTables(tables: string[]): Promise<CatalogForeignKey[]> {
    if (tables.length === 0) return [];
    const { data, error } = await db()
      .from("foreign_keys")
      .select("table_name, column_name, ref_table, ref_column")
      .in("table_name", tables);
    if (error) throw new Error(`getForeignKeysForTables: ${error.message}`);
    return (data ?? []).map((r) => ({
      table: r.table_name as string,
      column: r.column_name as string,
      refTable: r.ref_table as string,
      refColumn: r.ref_column as string,
    }));
  },

  async getTrustedExamples(): Promise<AgentExample[]> {
    const { data, error } = await db()
      .from("examples")
      .select("question, sql")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`getTrustedExamples: ${error.message}`);
    return (data ?? []).map((r) => ({
      question: r.question as string,
      sql: r.sql as string,
    }));
  },

  async insertQueryLog(entry: QueryLogEntry): Promise<string> {
    const { data, error } = await db()
      .from("query_log")
      .insert({
        question: entry.question,
        sql: entry.sql,
        attempts: entry.attempts,
        row_count: entry.rowCount,
        success: entry.success,
        error: entry.error,
        user_email: entry.userEmail,
        est_cost: entry.estCost ?? null,
        est_rows: entry.estRows ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`insertQueryLog: ${error.message}`);
    return data!.id as string;
  },

  async promoteLogToExample(logId: string): Promise<void> {
    const { data: log, error: logErr } = await db()
      .from("query_log")
      .select("question, sql, success")
      .eq("id", logId)
      .single();
    if (logErr) throw new Error(`promoteLogToExample(read): ${logErr.message}`);
    if (!log || !log.success || !log.sql) {
      throw new Error("Cannot promote a failed or missing query");
    }
    const { error } = await db().from("examples").insert({
      question: log.question as string,
      sql: log.sql as string,
      source_log_id: logId,
    });
    if (error) throw new Error(`promoteLogToExample(write): ${error.message}`);
  },

  async replaceCatalog(input): Promise<void> {
    const c = db();

    // Preserve existing human-entered descriptions.
    const { data: existingCols } = await c
      .from("column_catalog")
      .select("table_name, column_name, description");
    const colDesc = new Map<string, string | null>(
      (existingCols ?? []).map((r) => [
        `${r.table_name}.${r.column_name}`,
        (r.description as string | null) ?? null,
      ])
    );
    const { data: existingTables } = await c
      .from("table_catalog")
      .select("table_name, description");
    const tableDesc = new Map<string, string | null>(
      (existingTables ?? []).map((r) => [
        r.table_name as string,
        (r.description as string | null) ?? null,
      ])
    );

    // Rebuild foreign_keys wholesale.
    await c.from("foreign_keys").delete().neq("id", 0);
    if (input.foreignKeys.length > 0) {
      const { error } = await c.from("foreign_keys").insert(
        input.foreignKeys.map((fk) => ({
          table_name: fk.table,
          column_name: fk.column,
          ref_table: fk.refTable,
          ref_column: fk.refColumn,
        }))
      );
      if (error) throw new Error(`replaceCatalog(fks): ${error.message}`);
    }

    // Upsert tables, keeping descriptions.
    const { error: tErr } = await c.from("table_catalog").upsert(
      input.tables.map((t) => ({
        table_name: t,
        description: tableDesc.get(t) ?? null,
      })),
      { onConflict: "table_name" }
    );
    if (tErr) throw new Error(`replaceCatalog(tables): ${tErr.message}`);

    // Upsert columns, keeping descriptions.
    const { error: cErr } = await c.from("column_catalog").upsert(
      input.columns.map((col) => ({
        table_name: col.table,
        column_name: col.column,
        data_type: col.dataType,
        is_nullable: col.isNullable,
        description: colDesc.get(`${col.table}.${col.column}`) ?? null,
      })),
      { onConflict: "table_name,column_name" }
    );
    if (cErr) throw new Error(`replaceCatalog(columns): ${cErr.message}`);
  },
};
