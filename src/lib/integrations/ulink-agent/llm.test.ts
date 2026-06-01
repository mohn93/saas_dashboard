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
