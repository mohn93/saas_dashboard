import { describe, expect, it, vi } from "vitest";
import { runAgent } from "./loop";
import type { LLMClient } from "./llm";
import type { AgentEvent } from "./events";
import type { MemoryStore, QueryResult } from "./types";

function fakeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    getTableSummaries: async () => [{ table: "links", description: null }],
    getColumnsForTables: async () => [
      { table: "links", column: "id", dataType: "uuid", isNullable: false, description: null },
    ],
    getForeignKeysForTables: async () => [],
    getTrustedExamples: async () => [],
    insertQueryLog: async () => "log-1",
    promoteLogToExample: async () => {},
    replaceCatalog: async () => {},
    ...overrides,
  };
}

function streamReturning(text: string): LLMClient["stream"] {
  return async (_messages, handlers) => {
    handlers.onContent?.(text);
    return text;
  };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };

describe("runAgent", () => {
  it("chat path: narrates a reply, no result, done", async () => {
    const fast: LLMClient = {
      model: "fast",
      complete: vi.fn().mockResolvedValue('{"kind":"chat","reply":"Hi there!"}'),
      stream: streamReturning(""),
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
    };
    const reasoner: LLMClient = { model: "r", complete: vi.fn(), stream: vi.fn(), chatWithTools: async () => ({ content: null, toolCalls: [] }) };
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "hello", userEmail: null },
      { fast, reasoner, memory: fakeMemory(), execute: vi.fn() },
      (e) => events.push(e)
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("narration");
    expect(types).toContain("done");
    expect(types).not.toContain("result");
    const narration = events.find((e) => e.type === "narration");
    expect(narration && "delta" in narration && narration.delta).toContain("Hi there!");
  });

  it("data path: selects, writes SQL, runs, emits result, narrates, done", async () => {
    const fast: LLMClient = {
      model: "fast",
      complete: vi
        .fn()
        .mockResolvedValueOnce('{"kind":"data"}') // planner
        .mockResolvedValueOnce('["links"]'), // selectTables
      stream: streamReturning("You have 5 links."), // narrate
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
    };
    const reasoner: LLMClient = {
      model: "r",
      complete: vi.fn(),
      stream: async (_m, h) => {
        h.onReasoning?.("thinking about links");
        const out = '{"sql":"SELECT count(*) AS n FROM links","chart":{"type":"none","xColumn":null,"yColumn":null}}';
        h.onContent?.(out);
        return out;
      },
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
    };
    const execute = vi.fn().mockResolvedValue(okResult);
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "how many links", userEmail: "pm@x.com" },
      { fast, reasoner, memory: fakeMemory(), execute },
      (e) => events.push(e)
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["phase", "step", "reasoning", "sql", "result", "narration", "done"])
    );
    const result = events.find((e) => e.type === "result");
    expect(result && "rowCount" in result && result.rowCount).toBe(1);
    const done = events.find((e) => e.type === "done");
    expect(done && "logId" in done && done.logId).toBe("log-1");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("data path: emits error after exhausting attempts", async () => {
    const fast: LLMClient = {
      model: "fast",
      complete: vi
        .fn()
        .mockResolvedValueOnce('{"kind":"data"}')
        .mockResolvedValueOnce('["links"]'),
      stream: streamReturning(""),
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
    };
    const reasoner: LLMClient = {
      model: "r",
      complete: vi.fn(),
      stream: async (_m, h) => {
        const out = '{"sql":"SELECT bad FROM links","chart":{"type":"none","xColumn":null,"yColumn":null}}';
        h.onContent?.(out);
        return out;
      },
      chatWithTools: async () => ({ content: null, toolCalls: [] }),
    };
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const insertQueryLog = vi.fn().mockResolvedValue("log-err");
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "q", userEmail: null },
      { fast, reasoner, memory: fakeMemory({ insertQueryLog }), execute, maxAttempts: 2 },
      (e) => events.push(e)
    );
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(insertQueryLog).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
