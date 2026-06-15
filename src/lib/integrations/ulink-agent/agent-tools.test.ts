import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchTool, TOOL_DEFS, type ToolContext } from "./agent-tools";
import { stashPending } from "./pending";
import type { LLMClient } from "./llm";
import type { AgentEvent } from "./events";
import type { MemoryStore, QueryResult } from "./types";

// Stub the pending stash so the gate-trip test never touches Redis.
vi.mock("./pending", () => ({ stashPending: vi.fn().mockResolvedValue("tok-123") }));

function fakeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    getTableSummaries: async () => [{ table: "links", description: "deep links" }],
    getColumnsForTables: async () => [
      { table: "links", column: "id", dataType: "uuid", isNullable: false, description: null },
      { table: "links", column: "slug", dataType: "text", isNullable: false, description: null },
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
    chatWithTools: vi.fn(),
    stream: async (_m, h) => {
      h.onContent?.(out);
      return out;
    },
  };
}

// Reasoner that returns a "bar" chart WITH usable axes (so a chart hint can override it).
function reasonerWithBarChart(sql: string): LLMClient {
  const out = `{"sql":${JSON.stringify(sql)},"chart":{"type":"bar","xColumn":"month","yColumn":"n"}}`;
  return {
    model: "r1",
    chatWithTools: vi.fn(),
    stream: async (_m, h) => {
      h.onContent?.(out);
      return out;
    },
  };
}

function ctxWith(opts: {
  reasoner: LLMClient;
  execute: ToolContext["execute"];
  memory?: MemoryStore;
  events: AgentEvent[];
}): ToolContext {
  return {
    reasoner: opts.reasoner,
    memory: opts.memory ?? fakeMemory(),
    execute: opts.execute,
    emit: (e) => opts.events.push(e),
    userEmail: "pm@x.com",
    conversationId: null,
    maxRows: 1000,
  };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };

describe("TOOL_DEFS", () => {
  it("exposes exactly query and clarify", () => {
    expect(TOOL_DEFS.map((t) => t.function.name).sort()).toEqual(["clarify", "query"]);
  });
});

describe("dispatchTool: query", () => {
  it("generates SQL, runs it, emits sql+result, returns rows and a logId", async () => {
    const events: AgentEvent[] = [];
    const execute = vi.fn().mockResolvedValue(okResult);
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT count(*) AS n FROM links"), execute, events });
    const outcome = await dispatchTool(
      { id: "c1", name: "query", arguments: JSON.stringify({ question: "how many links?" }) },
      ctx
    );
    // execute is called twice: once for EXPLAIN (cost-gate) and once for the real query
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["step", "sql", "result"]));
    expect(outcome.logId).toBe("log-1");
    const parsed = JSON.parse(outcome.content);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows).toEqual([{ n: 5 }]);
  });

  it("honors the chart arg — a pie request renders pie even if the model picked bar", async () => {
    const events: AgentEvent[] = [];
    const execute = vi.fn().mockResolvedValue({
      columns: ["month", "n"],
      rows: [{ month: "2026-04", n: 4 }],
      rowCount: 1,
    });
    const ctx = ctxWith({
      reasoner: reasonerWithBarChart("SELECT m AS month, count(*) AS n FROM s GROUP BY m"),
      execute,
      events,
    });
    await dispatchTool(
      {
        id: "c1",
        name: "query",
        arguments: JSON.stringify({ question: "cancellations per month", chart: "pie" }),
      },
      ctx
    );
    const result = events.find((e) => e.type === "result");
    expect(result && "chart" in result && result.chart?.type).toBe("pie");
  });

  it("returns an error (no result event) when validation rejects the SQL", async () => {
    const events: AgentEvent[] = [];
    const execute = vi.fn();
    const ctx = ctxWith({ reasoner: reasonerReturning("DELETE FROM links"), execute, events });
    const outcome = await dispatchTool(
      { id: "c1", name: "query", arguments: JSON.stringify({ question: "drop everything" }) },
      ctx
    );
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "result")).toBe(false);
    expect(JSON.parse(outcome.content).error).toBeTruthy();
  });

  it("emits display='table' by default", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("table");
  });

  it("emits display='chart' when display arg is chart", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q", display: "chart" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("chart");
  });

  it("treats a chart type with no display as display='chart'", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning("SELECT 1 AS n FROM links"), execute: vi.fn().mockResolvedValue(okResult), events });
    await dispatchTool({ id: "c1", name: "query", arguments: JSON.stringify({ question: "q", chart: "pie" }) }, ctx);
    const result = events.find((e) => e.type === "result");
    expect(result && "display" in result && result.display).toBe("chart");
  });

  it("returns an error when execution throws (logs failure)", async () => {
    const events: AgentEvent[] = [];
    const insertQueryLog = vi.fn().mockResolvedValue("log-err");
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const ctx = ctxWith({
      reasoner: reasonerReturning("SELECT 1 AS n FROM links"),
      execute,
      events,
      memory: fakeMemory({ insertQueryLog }),
    });
    const outcome = await dispatchTool(
      { id: "c1", name: "query", arguments: JSON.stringify({ question: "q" }) },
      ctx
    );
    expect(JSON.parse(outcome.content).error).toContain("boom");
    expect(insertQueryLog).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(outcome.logId).toBeUndefined();
  });
});

describe("dispatchTool: query — cost-gate trips", () => {
  const prevEnabled = process.env.ULINK_AGENT_GATE_ENABLED;
  const prevMaxCost = process.env.ULINK_AGENT_MAX_PLAN_COST;
  const prevMaxRows = process.env.ULINK_AGENT_MAX_PLAN_ROWS;

  afterEach(() => {
    // Restore env so the rest of the suite stays in shadow mode (gate disabled).
    process.env.ULINK_AGENT_GATE_ENABLED = prevEnabled;
    process.env.ULINK_AGENT_MAX_PLAN_COST = prevMaxCost;
    process.env.ULINK_AGENT_MAX_PLAN_ROWS = prevMaxRows;
    vi.mocked(stashPending).mockClear();
  });

  // EXPLAIN (FORMAT JSON) result that parses to a cost/rows estimate over budget.
  const explainResult: QueryResult = {
    columns: ["QUERY PLAN"],
    rows: [{ "QUERY PLAN": [{ Plan: { "Total Cost": 999999, "Plan Rows": 999999 } }] }],
    rowCount: 1,
  };

  it("stashes + returns confirm and never executes the query when over budget", async () => {
    process.env.ULINK_AGENT_GATE_ENABLED = "true";
    process.env.ULINK_AGENT_MAX_PLAN_COST = "0";
    process.env.ULINK_AGENT_MAX_PLAN_ROWS = "0";

    const events: AgentEvent[] = [];
    const insertQueryLog = vi.fn().mockResolvedValue("log-gated");
    // execute is called only for EXPLAIN; the real query must NOT run.
    const execute = vi.fn().mockResolvedValue(explainResult);
    const ctx = ctxWith({
      reasoner: reasonerReturning("SELECT count(*) AS n FROM links"),
      execute,
      events,
      memory: fakeMemory({ insertQueryLog }),
    });
    const outcome = await dispatchTool(
      { id: "c1", name: "query", arguments: JSON.stringify({ question: "how many links?" }) },
      ctx
    );

    // EXPLAIN only — the actual query is gated, so execute fires exactly once.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("EXPLAIN"));
    // No result was streamed (the query never ran).
    expect(events.some((e) => e.type === "result")).toBe(false);

    // The query was stashed for later confirmation.
    expect(stashPending).toHaveBeenCalledTimes(1);

    // The outcome carries a confirm payload with the token + estimate.
    expect(outcome.confirm).toEqual({
      token: "tok-123",
      estCost: 999999,
      estRows: 999999,
      sql: "SELECT count(*) AS n FROM links",
      question: "how many links?",
    });
    expect(JSON.parse(outcome.content).gated).toBe(true);

    // A gated row was logged: success:false with the "gated:" error prefix + estimate.
    expect(insertQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("gated:"),
        estCost: 999999,
        estRows: 999999,
      })
    );
  });
});

describe("dispatchTool: clarify and errors", () => {
  it("clarify returns the question as a terminal outcome", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning(""), execute: vi.fn(), events });
    const outcome = await dispatchTool(
      { id: "c1", name: "clarify", arguments: JSON.stringify({ question: "Which project?" }) },
      ctx
    );
    expect(outcome.clarify).toBe("Which project?");
  });

  it("returns an error for invalid JSON arguments", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning(""), execute: vi.fn(), events });
    const outcome = await dispatchTool({ id: "c1", name: "query", arguments: "not json" }, ctx);
    expect(JSON.parse(outcome.content).error).toBeTruthy();
  });

  it("returns an error for an unknown tool", async () => {
    const events: AgentEvent[] = [];
    const ctx = ctxWith({ reasoner: reasonerReturning(""), execute: vi.fn(), events });
    const outcome = await dispatchTool({ id: "c1", name: "frobnicate", arguments: "{}" }, ctx);
    expect(JSON.parse(outcome.content).error).toContain("Unknown tool");
  });
});
