import { Pool } from "pg";
import type { QueryResult } from "./types";

let pool: Pool | null = null;

export function getReadOnlyPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.ULINK_READONLY_DATABASE_URL;
  if (!connectionString) {
    throw new Error("ULINK_READONLY_DATABASE_URL must be set");
  }

  pool = new Pool({
    connectionString,
    max: 4,
    ssl: { rejectUnauthorized: false },
  });

  // Enforce read-only + a hard statement timeout on every connection.
  pool.on("connect", (client) => {
    client.query(
      "SET default_transaction_read_only = on; SET statement_timeout = 15000;"
    );
  });

  return pool;
}

export async function executeReadOnly(sql: string): Promise<QueryResult> {
  const client = await getReadOnlyPool().connect();
  try {
    const res = await client.query(sql);
    return {
      columns: res.fields.map((f) => f.name),
      rows: res.rows as Record<string, unknown>[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  } finally {
    client.release();
  }
}
