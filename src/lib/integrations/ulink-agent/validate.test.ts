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

  it("accepts a string literal containing a semicolon", () => {
    expect(validateSelect("SELECT id FROM users WHERE note = 'a; b'", 1000).ok).toBe(true);
  });
  it("accepts columns whose names contain command keywords", () => {
    expect(validateSelect("SELECT set, comment FROM audit_log", 1000).ok).toBe(true);
  });
  it("accepts a dollar-quoted string containing a keyword", () => {
    expect(validateSelect("SELECT $$ update later $$ AS note", 1000).ok).toBe(true);
  });
  it("rejects SELECT ... INTO", () => {
    expect(validateSelect("SELECT id INTO TEMP TABLE stolen FROM users", 1000).ok).toBe(false);
  });
  it("rejects side-effecting functions", () => {
    expect(validateSelect("SELECT dblink('h','DELETE FROM users')", 1000).ok).toBe(false);
    expect(validateSelect("SELECT pg_read_file('/etc/passwd')", 1000).ok).toBe(false);
  });
});
