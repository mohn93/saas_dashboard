export interface ValidationResult {
  ok: boolean;
  sql: string;
  error: string | null;
}

// Write/DDL keywords that are dangerous even embedded in a SELECT/WITH
// (writable CTEs, SELECT ... INTO).
const FORBIDDEN = [
  "insert", "update", "delete", "merge", "truncate",
  "drop", "alter", "create", "grant", "revoke", "into",
];

// Server-side functions that can exfiltrate/side-effect from a SELECT.
// Defense-in-depth; pm_readonly also lacks privileges for these.
const FORBIDDEN_FUNCTIONS = [
  "dblink", "pg_read_file", "pg_read_binary_file", "pg_ls_dir",
  "pg_write_file", "lo_import", "lo_export",
];

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " ");        // line comments
}

function stripLiterals(sql: string): string {
  // dollar-quoted strings: $$...$$ and $tag$...$tag$
  let out = sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, " '' ");
  // single-quoted strings, handling '' escapes
  out = out.replace(/'(?:[^']|'')*'/g, " '' ");
  return out;
}

export function validateSelect(raw: string, maxRows = 1000): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, sql: "", error });
  if (!raw || !raw.trim()) return fail("Empty query");

  let analyzed = stripComments(raw).trim().replace(/;\s*$/, "").trim();
  if (!analyzed) return fail("Empty query");

  const scan = stripLiterals(analyzed).toLowerCase();

  if (scan.includes(";")) return fail("Multiple statements are not allowed");
  if (!/^(select|with)\b/.test(scan)) {
    return fail("Only SELECT/WITH read queries are allowed");
  }
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`).test(scan)) return fail(`Disallowed keyword: ${kw}`);
  }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\b`).test(scan)) return fail(`Disallowed function: ${fn}`);
  }

  const wrapped = `SELECT * FROM (${analyzed}) AS _agent_sub LIMIT ${maxRows}`;
  return { ok: true, sql: wrapped, error: null };
}
