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
