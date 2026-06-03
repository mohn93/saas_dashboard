import { describe, expect, it } from "vitest";
import { extractJson, generateSql, parseSseLine, parseToolCalls } from "./llm";
import type { LLMClient } from "./llm";

function stubLLM(response: string): LLMClient {
  return {
    model: "test",
    complete: async () => response,
    stream: async (_messages, handlers) => {
      handlers.onContent?.(response);
      return response;
    },
    chatWithTools: async () => ({ content: null, toolCalls: [] }),
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

  it("accepts a pie chart type", async () => {
    const llm = stubLLM(
      '{"sql":"SELECT plan AS p, count(*) AS n FROM subscriptions GROUP BY plan","chart":{"type":"pie","xColumn":"p","yColumn":"n"}}'
    );
    const out = await generateSql(llm, {
      question: "cancellations by plan as a pie chart",
      columns: [],
      foreignKeys: [],
      examples: [],
    });
    expect(out.chart.type).toBe("pie");
    expect(out.chart.xColumn).toBe("p");
    expect(out.chart.yColumn).toBe("n");
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
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
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

describe("parseToolCalls", () => {
  it("extracts tool calls from an assistant message", () => {
    const out = parseToolCalls({
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "query", arguments: '{"question":"how many links?"}' } },
      ],
    });
    expect(out.content).toBeNull();
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toEqual({ id: "c1", name: "query", arguments: '{"question":"how many links?"}' });
  });

  it("returns content and no tool calls for a plain answer", () => {
    const out = parseToolCalls({ content: "You have 5 links." });
    expect(out.content).toBe("You have 5 links.");
    expect(out.toolCalls).toEqual([]);
  });

  it("drops malformed tool calls (missing id or name) and defaults arguments", () => {
    const out = parseToolCalls({
      content: null,
      tool_calls: [
        { id: "", function: { name: "query", arguments: "{}" } }, // no id → dropped
        { id: "c2", function: { name: "clarify" } }, // no arguments → "{}"
      ],
    });
    expect(out.toolCalls).toEqual([{ id: "c2", name: "clarify", arguments: "{}" }]);
  });
});
