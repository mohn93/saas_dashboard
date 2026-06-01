import { getReadOnlyPool } from "./client";
import { supabaseMemory } from "./memory";
import type { CatalogColumn, CatalogForeignKey, MemoryStore } from "./types";

const TABLES_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;

const COLUMNS_SQL = `
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;

const FKS_SQL = `
  SELECT tc.table_name AS table_name,
         kcu.column_name AS column_name,
         ccu.table_name AS ref_table,
         ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
`;

export async function introspectAndStore(
  memory: MemoryStore = supabaseMemory
): Promise<{ tableCount: number; columnCount: number; fkCount: number }> {
  const pool = getReadOnlyPool();
  const [tablesRes, columnsRes, fksRes] = await Promise.all([
    pool.query(TABLES_SQL),
    pool.query(COLUMNS_SQL),
    pool.query(FKS_SQL),
  ]);

  const tables: string[] = tablesRes.rows.map((r) => r.table_name as string);
  const columns: CatalogColumn[] = columnsRes.rows.map((r) => ({
    table: r.table_name as string,
    column: r.column_name as string,
    dataType: r.data_type as string,
    isNullable: (r.is_nullable as string) === "YES",
    description: null,
  }));
  const foreignKeys: CatalogForeignKey[] = fksRes.rows.map((r) => ({
    table: r.table_name as string,
    column: r.column_name as string,
    refTable: r.ref_table as string,
    refColumn: r.ref_column as string,
  }));

  await memory.replaceCatalog({ tables, columns, foreignKeys });
  return {
    tableCount: tables.length,
    columnCount: columns.length,
    fkCount: foreignKeys.length,
  };
}
