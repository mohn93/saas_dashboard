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
