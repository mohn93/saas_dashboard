import { describe, expect, it, vi } from "vitest";
import { runAgent } from "./loop";
import type { LLMClient, ToolChatResult } from "./llm";
import type { AgentEvent } from "./events";
import type { MemoryStore, QueryResult } from "./types";

function fakeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    getTableSummaries: async () => [{ table: "links", description: "deep links" }],
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

function reasonerReturning(sql: string): LLMClient {
  const out = `{"sql":${JSON.stringify(sql)},"chart":{"type":"none","xColumn":null,"yColumn":null}}`;
  return {
    model: "r1",
    complete: vi.fn(),
    chatWithTools: vi.fn(),
    stream: async (_m, h) => {
      h.onContent?.(out);
      return out;
    },
  };
}

function orchestratorReturning(...results: ToolChatResult[]): LLMClient {
  const fn = vi.fn();
  for (const r of results) fn.mockResolvedValueOnce(r);
  fn.mockResolvedValue({ content: "Done.", toolCalls: [] });
  return { model: "v3", complete: vi.fn(), stream: vi.fn(), chatWithTools: fn };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };
const queryCall = (q: string): ToolChatResult => ({
  content: null,
  toolCalls: [{ id: "c1", name: "query", arguments: JSON.stringify({ question: q }) }],
});

describe("runAgent (tool-calling loop)", () => {
  it("runs a query tool then answers with narration + done(logId)", async () => {
    const orchestrator = orchestratorReturning(queryCall("how many links?"), {
      content: "You have 5 links.",
      toolCalls: [],
    });
    const reasoner = reasonerReturning("SELECT count(*) AS n FROM links");
    const execute = vi.fn().mockResolvedValue(okResult);
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "how many links?", userEmail: "pm@x.com" },
      { orchestrator, reasoner, memory: fakeMemory(), execute },
      (e) => events.push(e)
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["sql", "result", "narration", "done"]));
    const narration = events.find((e) => e.type === "narration");
    expect(narration && "delta" in narration && narration.delta).toContain("5 links");
    const done = events.find((e) => e.type === "done");
    expect(done && "logId" in done && done.logId).toBe("log-1");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("chat path: answers directly with no tool calls", async () => {
    const orchestrator = orchestratorReturning({ content: "Hi! Ask me about ULink data.", toolCalls: [] });
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "hello", userEmail: null },
      { orchestrator, reasoner: reasonerReturning(""), memory: fakeMemory(), execute: vi.fn() },
      (e) => events.push(e)
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("narration");
    expect(types).toContain("done");
    expect(types).not.toContain("result");
  });

  it("clarify: emits the question + done and stops looping", async () => {
    const clarifyCall: ToolChatResult = {
      content: null,
      toolCalls: [{ id: "c1", name: "clarify", arguments: JSON.stringify({ question: "Which project?" }) }],
    };
    const orchestrator = orchestratorReturning(clarifyCall);
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "is he churned?", userEmail: null },
      { orchestrator, reasoner: reasonerReturning(""), memory: fakeMemory(), execute: vi.fn() },
      (e) => events.push(e)
    );
    const narration = events.find((e) => e.type === "narration");
    expect(narration && "delta" in narration && narration.delta).toBe("Which project?");
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect((orchestrator.chatWithTools as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("emits an error when the step cap is exceeded", async () => {
    const orchestrator: LLMClient = {
      model: "v3",
      complete: vi.fn(),
      stream: vi.fn(),
      chatWithTools: vi.fn().mockResolvedValue(queryCall("loop forever")),
    };
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "loop", userEmail: null },
      { orchestrator, reasoner: reasonerReturning("SELECT 1 AS n FROM links"), memory: fakeMemory(), execute: vi.fn().mockResolvedValue(okResult), maxSteps: 2 },
      (e) => events.push(e)
    );
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect((orchestrator.chatWithTools as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("recovers from a bad tool call and still answers", async () => {
    const badArgs: ToolChatResult = {
      content: null,
      toolCalls: [{ id: "c1", name: "query", arguments: "not json" }],
    };
    const orchestrator = orchestratorReturning(badArgs, { content: "All set.", toolCalls: [] });
    const events: AgentEvent[] = [];
    await runAgent(
      { question: "q", userEmail: null },
      { orchestrator, reasoner: reasonerReturning(""), memory: fakeMemory(), execute: vi.fn() },
      (e) => events.push(e)
    );
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "result")).toBe(false);
    const narration = events.find((e) => e.type === "narration");
    expect(narration && "delta" in narration && narration.delta).toBe("All set.");
  });
});
