import { describe, expect, it } from "vitest";
import { extractJson, selectTables, generateSql, parseSseLine, planMessage } from "./llm";
import type { LLMClient } from "./llm";

function stubLLM(response: string): LLMClient {
  return {
    model: "test",
    complete: async () => response,
    stream: async (_messages, handlers) => {
      handlers.onContent?.(response);
      return response;
    },
  };
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

describe("parseSseLine", () => {
  it("parses a content delta", () => {
    const line = 'data: {"choices":[{"delta":{"content":"hel"}}]}';
    expect(parseSseLine(line)).toEqual({ content: "hel", reasoning: "" });
  });
  it("parses a reasoning delta", () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}';
    expect(parseSseLine(line)).toEqual({ content: "", reasoning: "think" });
  });
  it("returns null for [DONE] and non-data lines", () => {
    expect(parseSseLine("data: [DONE]")).toBeNull();
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine(": keep-alive")).toBeNull();
  });
  it("returns null for malformed JSON", () => {
    expect(parseSseLine("data: {not json")).toBeNull();
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

describe("planMessage", () => {
  it("classifies a data question", async () => {
    const llm = stubLLM('{"kind":"data"}');
    const out = await planMessage(llm, "how many links?", [], [{ table: "links", description: null }]);
    expect(out.kind).toBe("data");
  });
  it("classifies chat and returns a reply", async () => {
    const llm = stubLLM('{"kind":"chat","reply":"Hi! Ask me about ULink data."}');
    const out = await planMessage(llm, "hello", [], []);
    expect(out.kind).toBe("chat");
    expect(out.reply).toContain("Hi");
  });
  it("falls back to data on parse failure", async () => {
    const llm = stubLLM("not json");
    const out = await planMessage(llm, "x", [], []);
    expect(out.kind).toBe("data");
  });
});

describe("generateSql streaming", () => {
  it("emits reasoning deltas and returns sql", async () => {
    const reasoningSeen: string[] = [];
    const llm: LLMClient = {
      model: "r",
      complete: async () => "",
      stream: async (_m, h) => {
        h.onReasoning?.("let me think");
        const out = '{"sql":"SELECT 1 AS n","chart":{"type":"none","xColumn":null,"yColumn":null}}';
        h.onContent?.(out);
        return out;
      },
    };
    const gen = await generateSql(
      llm,
      { question: "q", columns: [], foreignKeys: [], examples: [] },
      (d) => reasoningSeen.push(d)
    );
    expect(gen.sql).toContain("SELECT 1");
    expect(reasoningSeen).toContain("let me think");
  });
});
