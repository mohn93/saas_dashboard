# ULink PM Query Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat section to the Flywheel Command Center where a PM asks natural-language questions, which an LLM turns into a single read-only `SELECT` against ULink's database; results render as a table + chart and never go back to the LLM.

**Architecture:** A new `ulink-agent` integration module runs a bounded loop (select tables → generate SQL → validate → execute → self-correct on error, ≤3 attempts). SQL executes via node-postgres under a dedicated read-only Postgres role (`pm_readonly`). Agent memory (introspected schema catalog, trusted examples, query log) lives in a `pm_agent` schema inside ULink's Supabase, read/written via the existing service-role REST client — deliberately separate from the read-only query path. The LLM sits behind a small `LLMClient` interface (default DeepSeek, OpenAI-compatible). Only schema + question + trusted examples ever leave the server.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `pg` (node-postgres), `@supabase/supabase-js` (service role, `.schema('pm_agent')`), Tremor charts, shadcn/ui, Vitest, DeepSeek API.

---

## Reference: spec

Design doc: `docs/superpowers/specs/2026-06-01-ulink-pm-query-agent-design.md`. Read it before starting.

## File Structure

**New — integration module** (`src/lib/integrations/ulink-agent/`):
- `types.ts` — all shared types for the agent
- `validate.ts` — SQL safety validator (pure, heavily tested)
- `client.ts` — node-postgres read-only pool + `executeReadOnly()`
- `memory.ts` — `pm_agent` CRUD via service-role client; implements `MemoryStore`
- `introspect.ts` — reflect ULink schema via pg, persist to catalog
- `llm.ts` — `LLMClient` interface, DeepSeek client, `extractJson`, `selectTables`, `generateSql`
- `loop.ts` — `answerQuestion()` bounded loop, dependency-injected for testing
- `*.test.ts` — colocated Vitest tests

**New — API routes:**
- `src/app/api/agent/query/route.ts`
- `src/app/api/agent/feedback/route.ts`
- `src/app/api/agent/schema/refresh/route.ts`

**New — UI:**
- `src/app/(dashboard)/agent/page.tsx`
- `src/components/agent/result-view.tsx`
- `src/hooks/use-agent-query.ts`

**New — SQL setup (run manually on ULink DB):**
- `supabase/pm_readonly_role.sql`
- `supabase/pm_agent_schema.sql`

**Modified:**
- `package.json` — add `pg`, `@types/pg`
- `.env.example` — add `ULINK_READONLY_DATABASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`
- `src/components/layout/sidebar.tsx` — add "PM Agent" nav item

## Spec → realization note (memory writes)

The spec describes examples captured as `unverified` then promoted to `trusted`. This plan realizes that as: **`pm_agent.query_log` is the capture of every successful query (the unverified record); `pm_agent.examples` holds only trusted rows, created from a log row on PM 👍.** Behavior matches the spec (only trusted examples are used as few-shot context; everything is captured), with less duplication.

---

## Task 0: Dependencies, env, and SQL setup files

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `supabase/pm_readonly_role.sql`
- Create: `supabase/pm_agent_schema.sql`

- [ ] **Step 1: Install node-postgres**

Run:
```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
npm install pg && npm install -D @types/pg
```
Expected: `package.json` gains `pg` in dependencies and `@types/pg` in devDependencies; no errors.

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:
```bash

# ULink read-only Postgres role (node-postgres connection string, session pooler)
# Format: postgresql://pm_readonly:<password>@<host>:5432/postgres
ULINK_READONLY_DATABASE_URL=postgresql://pm_readonly:password@db.cjgihassfsspxivjtgoi.supabase.co:5432/postgres

# LLM provider (OpenAI-compatible; default DeepSeek)
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

- [ ] **Step 3: Create the read-only role SQL**

Create `supabase/pm_readonly_role.sql`:
```sql
-- Run on ULink's Supabase database (SQL Editor) to create the read-only role
-- the PM Query Agent executes queries under. This role's GRANTs are the real
-- access boundary for the agent.

CREATE ROLE pm_readonly LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

GRANT CONNECT ON DATABASE postgres TO pm_readonly;
GRANT USAGE ON SCHEMA public TO pm_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pm_readonly;

-- Belt-and-suspenders: this role can never write, even if app guards fail.
ALTER ROLE pm_readonly SET default_transaction_read_only = on;

-- To later hide sensitive tables from the agent, REVOKE here; they disappear
-- from both introspection and the query path automatically. e.g.:
-- REVOKE SELECT ON public.<sensitive_table> FROM pm_readonly;
```

- [ ] **Step 4: Create the pm_agent schema SQL**

Create `supabase/pm_agent_schema.sql`:
```sql
-- Run on ULink's Supabase database (SQL Editor) to create the agent's memory.
-- AFTER running this, add 'pm_agent' to Supabase Dashboard → Settings → API →
-- "Exposed schemas" so the service-role REST client can reach it.

CREATE SCHEMA IF NOT EXISTS pm_agent;

CREATE TABLE pm_agent.table_catalog (
  table_name  TEXT PRIMARY KEY,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pm_agent.column_catalog (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  data_type   TEXT NOT NULL,
  is_nullable BOOLEAN NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

CREATE TABLE pm_agent.foreign_keys (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  ref_table   TEXT NOT NULL,
  ref_column  TEXT NOT NULL
);

CREATE TABLE pm_agent.query_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question    TEXT NOT NULL,
  sql         TEXT,
  attempts    INT NOT NULL DEFAULT 0,
  row_count   INT,
  success     BOOLEAN NOT NULL,
  error       TEXT,
  user_email  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pm_agent.examples (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question      TEXT NOT NULL,
  sql           TEXT NOT NULL,
  source_log_id UUID REFERENCES pm_agent.query_log(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service role bypasses RLS; no anon/public access is granted to pm_agent.
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example supabase/pm_readonly_role.sql supabase/pm_agent_schema.sql
git commit -m "chore: deps, env, and SQL setup for PM query agent"
```

---

## Task 1: Shared types

**Files:**
- Create: `src/lib/integrations/ulink-agent/types.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/integrations/ulink-agent/types.ts`:
```ts
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
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard && npx tsc --noEmit`
Expected: no errors referencing `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/types.ts
git commit -m "feat(agent): shared types for PM query agent"
```

---

## Task 2: SQL safety validator (TDD — security critical)

**Files:**
- Create: `src/lib/integrations/ulink-agent/validate.ts`
- Test: `src/lib/integrations/ulink-agent/validate.test.ts`

The validator accepts only a single read-only `SELECT`/`WITH…SELECT`, rejects everything else, and wraps the query in a `LIMIT`-capping subselect.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/integrations/ulink-agent/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateSelect } from "./validate";

describe("validateSelect", () => {
  it("accepts a simple SELECT and wraps it with a LIMIT cap", () => {
    const r = validateSelect("SELECT id FROM users", 1000);
    expect(r.ok).toBe(true);
    expect(r.sql.toLowerCase()).toContain("limit 1000");
    expect(r.sql.toLowerCase()).toContain("select id from users");
  });

  it("accepts a CTE that only reads", () => {
    const r = validateSelect("WITH t AS (SELECT 1 AS n) SELECT n FROM t", 1000);
    expect(r.ok).toBe(true);
  });

  it("strips a single trailing semicolon", () => {
    const r = validateSelect("SELECT 1;", 1000);
    expect(r.ok).toBe(true);
  });

  it.each([
    "UPDATE users SET email = 'x'",
    "DELETE FROM users",
    "INSERT INTO users (id) VALUES (1)",
    "DROP TABLE users",
    "ALTER TABLE users ADD COLUMN x int",
    "TRUNCATE users",
    "GRANT SELECT ON users TO bad",
    "MERGE INTO users USING src ON true WHEN MATCHED THEN DELETE",
    "WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x",
  ])("rejects non-read statement: %s", (sql) => {
    expect(validateSelect(sql, 1000).ok).toBe(false);
  });

  it("rejects multiple statements (semicolon smuggling)", () => {
    expect(validateSelect("SELECT 1; DROP TABLE users", 1000).ok).toBe(false);
  });

  it("rejects writes hidden in comments", () => {
    expect(validateSelect("SELECT 1 -- ; DROP TABLE users\n", 1000).ok).toBe(true);
    expect(validateSelect("SELECT 1 /* */; DELETE FROM users", 1000).ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateSelect("   ", 1000).ok).toBe(false);
  });

  it("rejects statements not starting with SELECT or WITH", () => {
    expect(validateSelect("EXPLAIN SELECT 1", 1000).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/validate.test.ts`
Expected: FAIL — `validateSelect` not defined.

- [ ] **Step 3: Implement the validator**

Create `src/lib/integrations/ulink-agent/validate.ts`:
```ts
export interface ValidationResult {
  ok: boolean;
  sql: string;
  error: string | null;
}

const FORBIDDEN = [
  "insert", "update", "delete", "merge", "truncate", "drop", "alter",
  "create", "grant", "revoke", "call", "do", "copy", "vacuum", "comment",
  "refresh", "reindex", "explain", "analyze", "set", "reset", "begin",
  "commit", "rollback", "savepoint", "listen", "notify", "lock", "prepare",
];

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " ");        // line comments
}

export function validateSelect(raw: string, maxRows = 1000): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, sql: "", error });

  if (!raw || !raw.trim()) return fail("Empty query");

  // Analyze a comment-free, single-trailing-semicolon-stripped copy.
  let analyzed = stripComments(raw).trim();
  analyzed = analyzed.replace(/;\s*$/, "").trim();

  if (analyzed.includes(";")) return fail("Multiple statements are not allowed");
  if (!analyzed) return fail("Empty query");

  const lower = analyzed.toLowerCase();
  if (!/^(select|with)\b/.test(lower)) {
    return fail("Only SELECT/WITH read queries are allowed");
  }

  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(lower)) {
      return fail(`Disallowed keyword: ${kw}`);
    }
  }

  // Wrap to enforce the row cap regardless of any inner LIMIT.
  const wrapped = `SELECT * FROM (${analyzed}) AS _agent_sub LIMIT ${maxRows}`;
  return { ok: true, sql: wrapped, error: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/validate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/validate.ts src/lib/integrations/ulink-agent/validate.test.ts
git commit -m "feat(agent): SQL safety validator with read-only enforcement"
```

---

## Task 3: Read-only Postgres client + executor

**Files:**
- Create: `src/lib/integrations/ulink-agent/client.ts`

This module owns the node-postgres pool and a single `executeReadOnly()`. No unit test (it needs a live DB); verified manually in Task 14.

- [ ] **Step 1: Implement the client**

Create `src/lib/integrations/ulink-agent/client.ts`:
```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/client.ts
git commit -m "feat(agent): read-only node-postgres pool and executor"
```

---

## Task 4: Memory store (pm_agent CRUD)

**Files:**
- Create: `src/lib/integrations/ulink-agent/memory.ts`

Implements `MemoryStore` using the existing service-role client via `.schema("pm_agent")`. `replaceCatalog` preserves human-entered descriptions across refreshes.

- [ ] **Step 1: Implement the memory store**

Create `src/lib/integrations/ulink-agent/memory.ts`:
```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/memory.ts
git commit -m "feat(agent): pm_agent memory store via service-role client"
```

---

## Task 5: Schema introspection

**Files:**
- Create: `src/lib/integrations/ulink-agent/introspect.ts`

Reads `information_schema` through the read-only pool and persists to the catalog via `MemoryStore`.

- [ ] **Step 1: Implement introspection**

Create `src/lib/integrations/ulink-agent/introspect.ts`:
```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/introspect.ts
git commit -m "feat(agent): schema introspection into pm_agent catalog"
```

---

## Task 6: LLM client + prompt functions (TDD on parsing)

**Files:**
- Create: `src/lib/integrations/ulink-agent/llm.ts`
- Test: `src/lib/integrations/ulink-agent/llm.test.ts`

- [ ] **Step 1: Write failing tests for JSON parsing and prompt functions**

Create `src/lib/integrations/ulink-agent/llm.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { extractJson, selectTables, generateSql } from "./llm";
import type { LLMClient } from "./llm";

function stubLLM(response: string): LLMClient {
  return { complete: async () => response };
}

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson("```json\n[\"users\"]\n```")).toEqual(["users"]);
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJson('Sure: {"sql":"SELECT 1"} done')).toEqual({ sql: "SELECT 1" });
  });
});

describe("selectTables", () => {
  it("returns the intersection with known tables", async () => {
    const llm = stubLLM('["users", "unknown_table"]');
    const out = await selectTables(llm, "how many users", [
      { table: "users", description: null },
      { table: "projects", description: null },
    ]);
    expect(out).toEqual(["users"]);
  });

  it("falls back to all tables when parsing fails", async () => {
    const llm = stubLLM("not json");
    const out = await selectTables(llm, "q", [
      { table: "users", description: null },
    ]);
    expect(out).toEqual(["users"]);
  });
});

describe("generateSql", () => {
  it("returns sql and chart from the model", async () => {
    const llm = stubLLM(
      '{"sql":"SELECT count(*) AS n FROM users","chart":{"type":"bar","xColumn":null,"yColumn":"n"}}'
    );
    const out = await generateSql(llm, {
      question: "how many users",
      columns: [],
      foreignKeys: [],
      examples: [],
    });
    expect(out.sql).toContain("SELECT count(*)");
    expect(out.chart.type).toBe("bar");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: FAIL — module/exports not defined.

- [ ] **Step 3: Implement the LLM module**

Create `src/lib/integrations/ulink-agent/llm.ts`:
```ts
import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  ChartSpec,
  ConversationTurn,
  TableSummary,
} from "./types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClient {
  complete(messages: LLMMessage[]): Promise<string>;
}

export function getDeepSeekClient(): LLMClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY must be set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  return {
    async complete(messages: LLMMessage[]): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: false }),
      });
      if (!res.ok) {
        throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM returned no content");
      return content;
    },
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to the first {...} or [...] span.
    const firstObj = body.indexOf("{");
    const firstArr = body.indexOf("[");
    const candidates: Array<[number, string, string]> = [];
    if (firstObj >= 0) candidates.push([firstObj, "{", "}"]);
    if (firstArr >= 0) candidates.push([firstArr, "[", "]"]);
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [start, , close] of candidates) {
      const end = body.lastIndexOf(close);
      if (end > start) {
        try {
          return JSON.parse(body.slice(start, end + 1));
        } catch {
          /* try next */
        }
      }
    }
    throw new Error("No JSON found in LLM response");
  }
}

export async function selectTables(
  llm: LLMClient,
  question: string,
  tables: TableSummary[]
): Promise<string[]> {
  const known = new Set(tables.map((t) => t.table));
  const list = tables
    .map((t) => `- ${t.table}${t.description ? `: ${t.description}` : ""}`)
    .join("\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You select which database tables are needed to answer a question. " +
        "Reply with ONLY a JSON array of table names (a subset of the provided list).",
    },
    { role: "user", content: `Question: ${question}\n\nTables:\n${list}` },
  ];

  try {
    const raw = await llm.complete(messages);
    const parsed = extractJson(raw);
    if (Array.isArray(parsed)) {
      const picked = parsed
        .filter((x): x is string => typeof x === "string")
        .filter((t) => known.has(t));
      if (picked.length > 0) return picked;
    }
  } catch {
    /* fall through */
  }
  return tables.map((t) => t.table); // safe fallback: everything
}

export interface GenerateSqlInput {
  question: string;
  columns: CatalogColumn[];
  foreignKeys: CatalogForeignKey[];
  examples: AgentExample[];
  history?: ConversationTurn[];
  priorError?: string | null;
}

export interface GeneratedSql {
  sql: string;
  chart: ChartSpec;
}

const DEFAULT_CHART: ChartSpec = { type: "none", xColumn: null, yColumn: null };

export async function generateSql(
  llm: LLMClient,
  input: GenerateSqlInput
): Promise<GeneratedSql> {
  const cols = input.columns
    .map(
      (c) =>
        `${c.table}.${c.column} (${c.dataType}${c.isNullable ? "" : ", not null"})` +
        (c.description ? ` -- ${c.description}` : "")
    )
    .join("\n");
  const fks = input.foreignKeys
    .map((f) => `${f.table}.${f.column} -> ${f.refTable}.${f.refColumn}`)
    .join("\n");
  const examples = input.examples
    .map((e) => `Q: ${e.question}\nSQL: ${e.sql}`)
    .join("\n\n");
  const history = (input.history ?? [])
    .map((h) => `Earlier Q: ${h.question}\nEarlier SQL: ${h.sql}`)
    .join("\n\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You translate a question into ONE read-only PostgreSQL SELECT. " +
        "Never write data (no INSERT/UPDATE/DELETE/DDL). Use only the given columns. " +
        'Reply with ONLY JSON: {"sql": string, "chart": {"type": "bar"|"line"|"area"|"none", ' +
        '"xColumn": string|null, "yColumn": string|null}}. ' +
        "Choose a chart only if the result is naturally chartable; otherwise type \"none\".",
    },
    {
      role: "user",
      content:
        `Question: ${input.question}\n\n` +
        (history ? `Conversation so far:\n${history}\n\n` : "") +
        `Columns:\n${cols}\n\n` +
        (fks ? `Foreign keys:\n${fks}\n\n` : "") +
        (examples ? `Proven examples:\n${examples}\n\n` : "") +
        (input.priorError
          ? `Your previous SQL failed with: ${input.priorError}\nFix it.\n`
          : ""),
    },
  ];

  const raw = await llm.complete(messages);
  const parsed = extractJson(raw) as { sql?: unknown; chart?: Partial<ChartSpec> };
  if (!parsed || typeof parsed.sql !== "string") {
    throw new Error("LLM did not return a SQL string");
  }
  const chart: ChartSpec = parsed.chart
    ? {
        type: (["bar", "line", "area", "none"].includes(parsed.chart.type as string)
          ? parsed.chart.type
          : "none") as ChartSpec["type"],
        xColumn: (parsed.chart.xColumn as string) ?? null,
        yColumn: (parsed.chart.yColumn as string) ?? null,
      }
    : DEFAULT_CHART;
  return { sql: parsed.sql, chart };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/llm.ts src/lib/integrations/ulink-agent/llm.test.ts
git commit -m "feat(agent): DeepSeek LLM client and prompt functions"
```

---

## Task 7: The bounded query loop (TDD)

**Files:**
- Create: `src/lib/integrations/ulink-agent/loop.ts`
- Test: `src/lib/integrations/ulink-agent/loop.test.ts`

`answerQuestion` is dependency-injected (llm, memory, execute) so it is fully unit-testable.

- [ ] **Step 1: Write failing tests**

Create `src/lib/integrations/ulink-agent/loop.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { answerQuestion } from "./loop";
import type { LLMClient } from "./llm";
import type { MemoryStore, QueryResult } from "./types";

function fakeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    getTableSummaries: async () => [{ table: "users", description: null }],
    getColumnsForTables: async () => [
      { table: "users", column: "id", dataType: "uuid", isNullable: false, description: null },
    ],
    getForeignKeysForTables: async () => [],
    getTrustedExamples: async () => [],
    insertQueryLog: async () => "log-123",
    promoteLogToExample: async () => {},
    replaceCatalog: async () => {},
    ...overrides,
  };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };

describe("answerQuestion", () => {
  it("returns rows and a logId on a successful first attempt", async () => {
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]') // selectTables
        .mockResolvedValueOnce('{"sql":"SELECT count(*) AS n FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi.fn().mockResolvedValue(okResult);

    const answer = await answerQuestion(
      { question: "how many users", userEmail: "pm@x.com" },
      { llm, memory: fakeMemory(), execute }
    );

    expect(answer.ok).toBe(true);
    expect(answer.result).toEqual(okResult);
    expect(answer.logId).toBe("log-123");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries on execution error then succeeds", async () => {
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]')
        .mockResolvedValueOnce('{"sql":"SELECT bad FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}')
        .mockResolvedValueOnce('{"sql":"SELECT count(*) AS n FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('column "bad" does not exist'))
      .mockResolvedValueOnce(okResult);

    const answer = await answerQuestion(
      { question: "q", userEmail: null },
      { llm, memory: fakeMemory(), execute, maxAttempts: 3 }
    );

    expect(answer.ok).toBe(true);
    expect(answer.attempts).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting attempts and logs the failure", async () => {
    const insertQueryLog = vi.fn().mockResolvedValue("log-err");
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]')
        .mockResolvedValue('{"sql":"SELECT bad FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi.fn().mockRejectedValue(new Error("boom"));

    const answer = await answerQuestion(
      { question: "q", userEmail: null },
      { llm, memory: fakeMemory({ insertQueryLog }), execute, maxAttempts: 2 }
    );

    expect(answer.ok).toBe(false);
    expect(answer.error).toBeTruthy();
    expect(insertQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: FAIL — `answerQuestion` not defined.

- [ ] **Step 3: Implement the loop**

Create `src/lib/integrations/ulink-agent/loop.ts`:
```ts
import { generateSql, selectTables, type LLMClient } from "./llm";
import { validateSelect } from "./validate";
import type {
  AgentAnswer,
  ChartSpec,
  ConversationTurn,
  MemoryStore,
  QueryResult,
} from "./types";

export interface LoopDeps {
  llm: LLMClient;
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxAttempts?: number;
}

export interface LoopInput {
  question: string;
  userEmail: string | null;
  history?: ConversationTurn[];
}

export async function answerQuestion(
  input: LoopInput,
  deps: LoopDeps
): Promise<AgentAnswer> {
  const maxRows = deps.maxRows ?? 1000;
  const maxAttempts = deps.maxAttempts ?? 3;

  const summaries = await deps.memory.getTableSummaries();
  const tables = await selectTables(deps.llm, input.question, summaries);
  const [columns, foreignKeys, examples] = await Promise.all([
    deps.memory.getColumnsForTables(tables),
    deps.memory.getForeignKeysForTables(tables),
    deps.memory.getTrustedExamples(),
  ]);

  let priorError: string | null = null;
  let lastSql: string | null = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    let chart: ChartSpec = { type: "none", xColumn: null, yColumn: null };
    try {
      const gen = await generateSql(deps.llm, {
        question: input.question,
        columns,
        foreignKeys,
        examples,
        history: input.history,
        priorError,
      });
      chart = gen.chart;
      lastSql = gen.sql;

      const v = validateSelect(gen.sql, maxRows);
      if (!v.ok) {
        priorError = v.error ?? "Invalid SQL";
        continue;
      }

      const result = await deps.execute(v.sql);
      const logId = await deps.memory.insertQueryLog({
        question: input.question,
        sql: gen.sql,
        attempts,
        rowCount: result.rowCount,
        success: true,
        error: null,
        userEmail: input.userEmail,
      });

      return { ok: true, sql: gen.sql, chart, result, error: null, attempts, logId };
    } catch (err) {
      priorError = err instanceof Error ? err.message : String(err);
    }
  }

  const logId = await deps.memory.insertQueryLog({
    question: input.question,
    sql: lastSql,
    attempts,
    rowCount: null,
    success: false,
    error: priorError,
    userEmail: input.userEmail,
  });

  return {
    ok: false,
    sql: lastSql,
    chart: null,
    result: null,
    error: priorError ?? "Failed to answer the question",
    attempts,
    logId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/loop.ts src/lib/integrations/ulink-agent/loop.test.ts
git commit -m "feat(agent): bounded generate-validate-execute-retry loop"
```

---

## Task 8: Query API route

**Files:**
- Create: `src/app/api/agent/query/route.ts`

Wires real deps into `answerQuestion` and resolves the requester's email from the Firebase session cookie.

- [ ] **Step 1: Implement the route**

Create `src/app/api/agent/query/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { answerQuestion } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";

export const dynamic = "force-dynamic";

async function getUserEmail(request: NextRequest): Promise<string | null> {
  const session = request.cookies.get("fw_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const history = Array.isArray(body.history)
    ? (body.history as ConversationTurn[]).slice(-5)
    : [];

  const userEmail = await getUserEmail(request);

  try {
    const answer = await answerQuestion(
      { question: body.question, userEmail, history },
      { llm: getDeepSeekClient(), memory: supabaseMemory, execute: executeReadOnly }
    );
    return NextResponse.json(answer);
  } catch (err) {
    console.error("Agent query failed:", err);
    return NextResponse.json(
      { error: "Agent failed to process the question" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/query/route.ts
git commit -m "feat(agent): POST /api/agent/query route"
```

---

## Task 9: Feedback API route

**Files:**
- Create: `src/app/api/agent/feedback/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/agent/feedback/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { logId?: unknown; helpful?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.logId !== "string" || typeof body.helpful !== "boolean") {
    return NextResponse.json(
      { error: "logId (string) and helpful (boolean) are required" },
      { status: 400 }
    );
  }

  // Only thumbs-up promotes a query into a trusted example.
  if (!body.helpful) {
    return NextResponse.json({ ok: true, promoted: false });
  }

  try {
    await supabaseMemory.promoteLogToExample(body.logId);
    return NextResponse.json({ ok: true, promoted: true });
  } catch (err) {
    console.error("Feedback promote failed:", err);
    return NextResponse.json({ error: "Could not record feedback" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/feedback/route.ts
git commit -m "feat(agent): POST /api/agent/feedback route"
```

---

## Task 10: Schema refresh API route

**Files:**
- Create: `src/app/api/agent/schema/refresh/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/agent/schema/refresh/route.ts`:
```ts
import { NextResponse } from "next/server";
import { introspectAndStore } from "@/lib/integrations/ulink-agent/introspect";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const counts = await introspectAndStore();
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    console.error("Schema refresh failed:", err);
    return NextResponse.json({ error: "Schema refresh failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/schema/refresh/route.ts
git commit -m "feat(agent): POST /api/agent/schema/refresh route"
```

---

## Task 11: Client hook

**Files:**
- Create: `src/hooks/use-agent-query.ts`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/use-agent-query.ts`:
```ts
"use client";

import { useState } from "react";
import type {
  AgentAnswer,
  ConversationTurn,
} from "@/lib/integrations/ulink-agent/types";

export interface AgentMessage {
  id: string;
  question: string;
  answer: AgentAnswer | null;
  loading: boolean;
  feedback: "up" | "down" | null;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

export function useAgentQuery() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  async function ask(question: string) {
    const id = nextId();
    setMessages((prev) => [
      ...prev,
      { id, question, answer: null, loading: true, feedback: null },
    ]);

    const history: ConversationTurn[] = messages
      .filter((m) => m.answer?.ok && m.answer.sql)
      .map((m) => ({ question: m.question, sql: m.answer!.sql as string }));

    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const answer = (await res.json()) as AgentAnswer;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, answer, loading: false } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                loading: false,
                answer: {
                  ok: false,
                  sql: null,
                  chart: null,
                  result: null,
                  error: "Network error",
                  attempts: 0,
                  logId: null,
                },
              }
            : m
        )
      );
    }
  }

  async function sendFeedback(messageId: string, logId: string, helpful: boolean) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, feedback: helpful ? "up" : "down" } : m
      )
    );
    try {
      await fetch("/api/agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, helpful }),
      });
    } catch {
      /* feedback is best-effort */
    }
  }

  return { messages, ask, sendFeedback };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-agent-query.ts
git commit -m "feat(agent): useAgentQuery client hook"
```

---

## Task 12: Result view component + agent page

**Files:**
- Create: `src/components/agent/result-view.tsx`
- Create: `src/app/(dashboard)/agent/page.tsx`

- [ ] **Step 1: Implement the result view**

Create `src/components/agent/result-view.tsx`:
```tsx
"use client";

import { useState } from "react";
import { BarChart, LineChart, AreaChart } from "@tremor/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";

function Chart({ answer }: { answer: AgentAnswer }) {
  const { chart, result } = answer;
  if (!chart || chart.type === "none" || !chart.xColumn || !chart.yColumn || !result) {
    return null;
  }
  const data = result.rows.map((r) => ({
    [chart.xColumn as string]: String(r[chart.xColumn as string]),
    [chart.yColumn as string]: Number(r[chart.yColumn as string]) || 0,
  }));
  const common = {
    data,
    index: chart.xColumn,
    categories: [chart.yColumn],
    className: "h-64 mt-4",
  } as const;

  if (chart.type === "line") return <LineChart {...common} />;
  if (chart.type === "area") return <AreaChart {...common} />;
  return <BarChart {...common} />;
}

export function ResultView({ answer }: { answer: AgentAnswer }) {
  const [showSql, setShowSql] = useState(false);

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
  return (
    <div className="space-y-3">
      <Chart answer={answer} />

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
            {result.rows.slice(0, 100).map((row, i) => (
              <TableRow key={i}>
                {result.columns.map((c) => (
                  <TableCell key={c}>{String(row[c] ?? "")}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
        {result.rowCount > 100 ? " (showing first 100)" : ""}
      </p>

      <button
        onClick={() => setShowSql((s) => !s)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {showSql ? "Hide SQL" : "View SQL"}
      </button>
      {showSql && (
        <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
          {answer.sql}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the agent page**

Create `src/app/(dashboard)/agent/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Send, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { useAgentQuery } from "@/hooks/use-agent-query";
import { ResultView } from "@/components/agent/result-view";
import { cn } from "@/lib/utils";

export default function AgentPage() {
  const { messages, ask, sendFeedback } = useAgentQuery();
  const [input, setInput] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void ask(q);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask questions about ULink in plain English. Read-only.
        </p>
      </div>

      <div className="mt-6 flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            e.g. &ldquo;How many signups per week over the last 8 weeks?&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-3">
            <div className="rounded-lg bg-accent/40 px-3 py-2 text-sm font-medium">
              {m.question}
            </div>
            {m.loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            )}
            {m.answer && <ResultView answer={m.answer} />}
            {m.answer?.ok && m.answer.logId && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => sendFeedback(m.id, m.answer!.logId!, true)}
                  className={cn(
                    "rounded-md p-1.5 hover:bg-accent",
                    m.feedback === "up" && "text-green-400"
                  )}
                  aria-label="Helpful"
                >
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => sendFeedback(m.id, m.answer!.logId!, false)}
                  className={cn(
                    "rounded-md p-1.5 hover:bg-accent",
                    m.feedback === "down" && "text-red-400"
                  )}
                  aria-label="Not helpful"
                >
                  <ThumbsDown className="h-4 w-4" />
                </button>
                {m.feedback === "up" && (
                  <span className="text-xs text-muted-foreground">
                    Saved as a trusted example
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mt-auto flex gap-2 border-t border-border/50 pt-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about ULink data…"
          className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds (the `/agent` route appears in the output). If Tremor chart prop types complain, confirm `@tremor/react` import names match those already used in `src/components/charts/`.

- [ ] **Step 4: Commit**

```bash
git add src/components/agent/result-view.tsx "src/app/(dashboard)/agent/page.tsx"
git commit -m "feat(agent): chat UI page and result view"
```

---

## Task 13: Sidebar nav link

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add the nav item**

In `src/components/layout/sidebar.tsx`, update the lucide import to include `MessageSquare`:
```tsx
import { BarChart3, Globe, Link2, Flame, X, MessageSquare } from "lucide-react";
```

Then add a "PM Agent" entry to `navItems`, after the products spread:
```tsx
  const navItems = [
    {
      href: "/",
      label: "Overview",
      icon: <BarChart3 className="h-4 w-4" />,
    },
    ...products.map((p) => ({
      href: `/${p.slug}`,
      label: p.name,
      icon: productIcons[p.slug],
      color: p.color,
    })),
    {
      href: "/agent",
      label: "PM Agent",
      icon: <MessageSquare className="h-4 w-4" />,
    },
  ];
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(agent): add PM Agent to sidebar nav"
```

---

## Task 14: Full test pass + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: all tests pass (existing ULink tests + new validate/llm/loop tests).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual DB prerequisites (one-time, outside the app)**

Do these against ULink's Supabase, then record completion:
1. Run `supabase/pm_readonly_role.sql` (set a real password).
2. Run `supabase/pm_agent_schema.sql`.
3. In Supabase Dashboard → Settings → API → "Exposed schemas", add `pm_agent`.
4. Put the real values in `.env.local`: `ULINK_READONLY_DATABASE_URL` (using the `pm_readonly` password, session pooler host), `DEEPSEEK_API_KEY`.
5. Add the PM's email to `ALLOWED_EMAILS`.

- [ ] **Step 4: Seed the catalog and smoke-test**

Run the dev server (`npm run dev`), log in, then:
1. `curl -X POST http://localhost:3000/api/agent/schema/refresh -H 'Cookie: fw_session=<copied-from-browser>'` → expect `{ ok: true, tableCount: >0, columnCount: >0 }`.
2. In the UI, open **PM Agent**, ask "how many users are there?" → expect a table with a count.
3. Click 👍 → expect "Saved as a trusted example"; confirm a row appears in `pm_agent.examples`.

- [ ] **Step 5: Verify read-only enforcement (security check)**

Using a `psql` session as `pm_readonly` against ULink:
```sql
UPDATE public.<any_table> SET id = id;
```
Expected: ERROR — `cannot execute UPDATE in a read-only transaction`.

- [ ] **Step 6: Final commit (if any docs/notes updated)**

```bash
git add -A
git commit -m "chore(agent): verification notes" || echo "nothing to commit"
```

---

## Definition of Done

- All unit tests pass; lint clean; `npm run build` succeeds.
- PM can log in, ask a question, see a table + (when applicable) a chart, view the SQL, and 👍 to save a trusted example.
- `pm_readonly` provably cannot write.
- Schema refresh repopulates the catalog without clobbering human-entered descriptions.
