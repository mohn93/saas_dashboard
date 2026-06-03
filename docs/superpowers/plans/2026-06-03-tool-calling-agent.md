# Tool-Calling Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PM Data Agent's fixed 4-call pipeline with a single tool-calling loop where V3 (`deepseek-chat`) orchestrates via native function-calling, calling a `query` tool (R1 writes the SQL) and a `clarify` tool, looping until it answers.

**Architecture:** `runAgent` becomes a loop: build V3's context (system prompt with table summaries + guardrails, conversation history incl. assistant replies, the question) → call V3 with tool defs → execute any tool calls, feed results back, loop (≤ `MAX_STEPS`) → when V3 returns text with no tool calls, that's the answer. The `query` tool delegates SQL authoring to R1 (`generateSql`) and runs it through the existing read-only path. The loop emits the **same `AgentEvent` protocol**, so the chat UI, conversation persistence, dashboards, and feedback are untouched. `planMessage`/`selectTables`/`narrate` are deleted.

**Tech Stack:** Next.js 14 App Router, TypeScript, DeepSeek OpenAI-compatible API (V3 function-calling + R1 for SQL), `pg` read-only pool, Vitest.

---

## Conventions for this plan (read first)

- **Branch:** Work on `feat/tool-calling-agent` (never commit to `main`). Task 1 creates it.
- **Test command:** `npx vitest run` (single file: `npx vitest run path/to/file.test.ts`).
- **Build/typecheck gate:** A dev server runs on :3002 — do **NOT** run `npm run build` (a production build clobbers the live dev server's `.next`). Use **`npx tsc --noEmit`** to typecheck, plus `npx vitest run`. (The controller runs a full build only at the very end if the dev server is stopped.)
- **Testing scope (matches existing `ulink-agent` code):** Pure logic + the loop/tools (with mocked LLM clients) ARE unit-tested — see the current `loop.test.ts` which mocks `fast`/`reasoner` clients. The supabase store, routes, and React stay untested.
- **Never `git add -A`** — a stray `._fix2.cjs` in the repo root must never be staged. Always `git add` exact paths.
- **DeepSeek function-calling:** `deepseek-chat` supports OpenAI-style `tools` + `tool_calls` on `POST {baseUrl}/chat/completions`. R1 (`deepseek-reasoner`) does not — it's only used inside the `query` tool via the existing `generateSql` (streaming).

---

## File structure

- `src/lib/integrations/ulink-agent/llm.ts` *(modify)* — add tool-calling types + `parseToolCalls` (pure) + `chatWithTools` to the client; later remove `planMessage`/`selectTables`/`narrate`/`PlanResult`/`getPlannerClient`. Keep `generateSql`, `extractJson`, `parseSseLine`, `getDeepSeekClient`, `getFastClient`, `buildClient`.
- `src/lib/integrations/ulink-agent/events.ts` *(modify)* — simplify `AgentPhase`.
- `src/lib/integrations/ulink-agent/agent-tools.ts` *(new)* — `TOOL_DEFS`, `ToolContext`, `ToolOutcome`, `dispatchTool` (+ internal `query`/`clarify` executors).
- `src/lib/integrations/ulink-agent/loop.ts` *(rewrite)* — `AgentDeps`, `AgentInput`, `runAgent` (the loop), `buildSystemPrompt`, `historyToMessages`.
- `src/app/api/agent/query/route.ts` *(modify)* — new deps (`orchestrator` + `reasoner`, drop `planner`).
- Tests: `llm.test.ts` *(modify)*, `agent-tools.test.ts` *(new)*, `loop.test.ts` *(rewrite)*.
- **Unchanged:** `use-agent-stream.ts`, `agent-message.tsx`, `result-view.tsx`, conversation persistence, dashboards, memory schema.

---

## Task 1: Tool-calling types + `parseToolCalls` + `chatWithTools`

**Files:**
- Modify: `src/lib/integrations/ulink-agent/llm.ts`
- Test: `src/lib/integrations/ulink-agent/llm.test.ts`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
git checkout main && git checkout -b feat/tool-calling-agent
```

- [ ] **Step 2: Write the failing test for `parseToolCalls`**

Append to `src/lib/integrations/ulink-agent/llm.test.ts` (and add `parseToolCalls` to the existing `import { ... } from "./llm"` line at the top):

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: FAIL — `parseToolCalls is not a function` / import error.

- [ ] **Step 4: Add the types + `parseToolCalls` + `chatWithTools`**

In `src/lib/integrations/ulink-agent/llm.ts`, replace the existing `LLMMessage` + `StreamHandlers` + `LLMClient` block (lines 11-25) with:

```ts
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Message shape for the tool-calling protocol (adds the `tool` role + tool_calls).
export interface LLMToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

// OpenAI-style tool definition.
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolChatResult {
  content: string | null;
  toolCalls: ParsedToolCall[];
}

export interface StreamHandlers {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface LLMClient {
  model: string;
  complete(messages: LLMMessage[]): Promise<string>;
  stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string>;
  chatWithTools(messages: LLMToolMessage[], tools: ToolDef[]): Promise<ToolChatResult>;
}

// Pure: normalize a /chat/completions assistant message into content + tool calls.
export function parseToolCalls(message: {
  content?: unknown;
  tool_calls?: unknown;
}): ToolChatResult {
  const raw = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: ParsedToolCall[] = raw
    .map((tc: Record<string, unknown>) => {
      const fn = (tc?.function ?? {}) as Record<string, unknown>;
      return {
        id: typeof tc?.id === "string" ? tc.id : "",
        name: typeof fn?.name === "string" ? fn.name : "",
        arguments: typeof fn?.arguments === "string" ? fn.arguments : "{}",
      };
    })
    .filter((tc: ParsedToolCall) => tc.id !== "" && tc.name !== "");
  return {
    content: typeof message?.content === "string" ? message.content : null,
    toolCalls,
  };
}
```

Then add the `chatWithTools` method to the object returned by `buildClient`. Inside `buildClient`'s returned object (after the `stream(...)` method, before the closing `};`), add:

```ts
    async chatWithTools(
      messages: LLMToolMessage[],
      tools: ToolDef[]
    ): Promise<ToolChatResult> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0,
          stream: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM tool call failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      return parseToolCalls(json?.choices?.[0]?.message ?? {});
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: PASS (including the existing `planMessage`/`selectTables`/`generateSql` tests — they still exist at this point).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0).

```bash
git add src/lib/integrations/ulink-agent/llm.ts src/lib/integrations/ulink-agent/llm.test.ts
git commit -m "feat(agent): tool-calling client (parseToolCalls + chatWithTools)"
```

---

## Task 2: Simplify `AgentPhase`

**Files:**
- Modify: `src/lib/integrations/ulink-agent/events.ts`

No new test (type-only). Verify with `npx tsc --noEmit` + existing suite.

- [ ] **Step 1: Narrow the phase union**

In `src/lib/integrations/ulink-agent/events.ts`, replace the `AgentPhase` type (lines 3-10) with:

```ts
export type AgentPhase = "working" | "running" | "done" | "error";
```

Leave the rest of the file (the `AgentEvent` union) unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (`message.ts` uses `AgentPhase | "idle"` generically; `agent-message.tsx`'s `PHASE_LABEL` is a `Record<string,string>` with a `"Working…"` fallback, so unknown phases render fine — no UI change needed.)

Note: `loop.test.ts` currently emits the old phases via the pipeline; it still compiles now (it doesn't construct `AgentPhase` literals directly — it reads `e.type`). It will be rewritten in Task 4 regardless. If `npx vitest run` surfaces any phase-literal type error in a test, it belongs to code replaced in Task 4 — proceed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/events.ts
git commit -m "feat(agent): simplify AgentPhase to working/running/done/error"
```

---

## Task 3: `agent-tools.ts` — tools + executors + dispatch

**Files:**
- Create: `src/lib/integrations/ulink-agent/agent-tools.ts`
- Test: `src/lib/integrations/ulink-agent/agent-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/integrations/ulink-agent/agent-tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { dispatchTool, TOOL_DEFS, type ToolContext } from "./agent-tools";
import type { LLMClient } from "./llm";
import type { AgentEvent } from "./events";
import type { MemoryStore, QueryResult } from "./types";

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

// A reasoner whose stream() emits a given SQL JSON (what generateSql parses).
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
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["step", "sql", "result"]));
    expect(outcome.logId).toBe("log-1");
    const parsed = JSON.parse(outcome.content);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows).toEqual([{ n: 5 }]);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/integrations/ulink-agent/agent-tools.test.ts`
Expected: FAIL — `Cannot find module './agent-tools'`.

- [ ] **Step 3: Implement `agent-tools.ts`**

Create `src/lib/integrations/ulink-agent/agent-tools.ts`:

```ts
import { generateSql, type LLMClient, type ParsedToolCall, type ToolDef } from "./llm";
import { validateSelect } from "./validate";
import type { AgentEvent } from "./events";
import type { MemoryStore, QueryResult } from "./types";

export const QUERY_TOOL = "query";
export const CLARIFY_TOOL = "clarify";
const MAX_PREVIEW_ROWS = 50; // rows handed back to the orchestrator (bounded for tokens)

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: QUERY_TOOL,
      description:
        "Answer a data question by writing and running ONE read-only SQL query against ULink's " +
        "database. Pass a clear, self-contained question in plain English; it returns the rows and " +
        "the SQL used. Use it to look things up and to verify whether something exists.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "A self-contained data question in plain English.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: CLARIFY_TOOL,
      description:
        "Ask the user a clarifying question when their request is ambiguous or missing detail " +
        "(e.g. an unclear referent, missing time range, or which entity/metric they mean). " +
        "Use this instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The clarifying question to ask the user." },
        },
        required: ["question"],
      },
    },
  },
];

export interface ToolContext {
  reasoner: LLMClient; // R1, writes the SQL inside `query`
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  emit: (event: AgentEvent) => void;
  userEmail: string | null;
  maxRows: number;
}

export interface ToolOutcome {
  content: string; // tool result string fed back to the orchestrator
  logId?: string; // set by a successful query → becomes the turn's primary logId
  clarify?: string; // set by clarify → the loop terminates, asking this question
}

async function runQuery(question: string, ctx: ToolContext): Promise<ToolOutcome> {
  ctx.emit({ type: "step", label: "Querying", detail: question });

  const summaries = await ctx.memory.getTableSummaries();
  const tables = summaries.map((t) => t.table);
  const [columns, foreignKeys, examples] = await Promise.all([
    ctx.memory.getColumnsForTables(tables),
    ctx.memory.getForeignKeysForTables(tables),
    ctx.memory.getTrustedExamples(),
  ]);

  let gen;
  try {
    gen = await generateSql(
      ctx.reasoner,
      { question, columns, foreignKeys, examples },
      (delta) => ctx.emit({ type: "reasoning", delta })
    );
  } catch (err) {
    return {
      content: JSON.stringify({
        error: err instanceof Error ? err.message : "Could not generate SQL",
      }),
    };
  }

  const v = validateSelect(gen.sql, ctx.maxRows);
  if (!v.ok) {
    await ctx.memory.insertQueryLog({
      question,
      sql: gen.sql,
      attempts: 1,
      rowCount: null,
      success: false,
      error: v.error,
      userEmail: ctx.userEmail,
    });
    return { content: JSON.stringify({ error: v.error ?? "Invalid SQL" }) };
  }

  ctx.emit({ type: "sql", sql: gen.sql });
  ctx.emit({ type: "phase", phase: "running" });

  let result: QueryResult;
  try {
    result = await ctx.execute(v.sql);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Query failed";
    await ctx.memory.insertQueryLog({
      question,
      sql: gen.sql,
      attempts: 1,
      rowCount: null,
      success: false,
      error,
      userEmail: ctx.userEmail,
    });
    return { content: JSON.stringify({ error }) };
  }

  ctx.emit({
    type: "result",
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    chart: gen.chart,
  });

  const logId = await ctx.memory.insertQueryLog({
    question,
    sql: gen.sql,
    attempts: 1,
    rowCount: result.rowCount,
    success: true,
    error: null,
    userEmail: ctx.userEmail,
  });

  return {
    content: JSON.stringify({
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows.slice(0, MAX_PREVIEW_ROWS),
      sql: gen.sql,
    }),
    logId,
  };
}

export async function dispatchTool(
  call: ParsedToolCall,
  ctx: ToolContext
): Promise<ToolOutcome> {
  let args: { question?: unknown };
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { content: JSON.stringify({ error: `Invalid JSON arguments for ${call.name}` }) };
  }
  const question = typeof args.question === "string" ? args.question.trim() : "";

  if (call.name === QUERY_TOOL) {
    if (!question) return { content: JSON.stringify({ error: "query requires a 'question' string" }) };
    return runQuery(question, ctx);
  }
  if (call.name === CLARIFY_TOOL) {
    if (!question) return { content: JSON.stringify({ error: "clarify requires a 'question' string" }) };
    return { content: "Clarification requested from the user.", clarify: question };
  }
  return { content: JSON.stringify({ error: `Unknown tool: ${call.name}` }) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/agent-tools.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0).

```bash
git add src/lib/integrations/ulink-agent/agent-tools.ts src/lib/integrations/ulink-agent/agent-tools.test.ts
git commit -m "feat(agent): query + clarify tools with dispatcher"
```

---

## Task 4: Rewrite `runAgent` as the tool-calling loop

**Files:**
- Rewrite: `src/lib/integrations/ulink-agent/loop.ts`
- Rewrite: `src/lib/integrations/ulink-agent/loop.test.ts`

- [ ] **Step 1: Replace the loop test**

Replace the ENTIRE contents of `src/lib/integrations/ulink-agent/loop.test.ts` with:

```ts
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

// Reasoner whose stream() yields a fixed SQL JSON (parsed by generateSql).
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

// Orchestrator (V3) whose chatWithTools returns scripted results in order.
function orchestratorReturning(...results: ToolChatResult[]): LLMClient {
  const fn = vi.fn();
  for (const r of results) fn.mockResolvedValueOnce(r);
  // default after the script: a final answer with no tool calls
  fn.mockResolvedValue({ content: "Done.", toolCalls: [] });
  return { model: "v3", complete: vi.fn(), stream: vi.fn(), chatWithTools: fn };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };
const queryCall = (q: string) => ({
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
    // chatWithTools called exactly once — the loop stopped after clarify
    expect((orchestrator.chatWithTools as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("emits an error when the step cap is exceeded", async () => {
    // Always returns a tool call → never finishes.
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: FAIL — `runAgent` still has the old pipeline signature (`fast`/`planner` deps); the new tests use `orchestrator` and `chatWithTools`.

- [ ] **Step 3: Rewrite `loop.ts`**

Replace the ENTIRE contents of `src/lib/integrations/ulink-agent/loop.ts` with:

```ts
import { TOOL_DEFS, dispatchTool, type ToolContext } from "./agent-tools";
import type { LLMClient, LLMToolMessage } from "./llm";
import type { AgentEvent } from "./events";
import type { ConversationTurn, MemoryStore, QueryResult, TableSummary } from "./types";

export interface AgentDeps {
  orchestrator: LLMClient; // V3, tool-calling
  reasoner: LLMClient; // R1, used by the query tool
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxSteps?: number;
}

export interface AgentInput {
  question: string;
  userEmail: string | null;
  history?: ConversationTurn[];
}

function buildSystemPrompt(tables: TableSummary[]): string {
  const tableList = tables
    .map((t) => `- ${t.table}${t.description ? `: ${t.description}` : ""}`)
    .join("\n");
  return [
    "You are the PM Data Agent for ULink. You answer questions about ULink's data by calling tools.",
    "Use the `query` tool to get data — it writes and runs read-only SQL for you; just ask a clear, " +
      "self-contained question in plain English. Use `clarify` to ask the user when the request is " +
      "ambiguous. When you have enough to answer, reply in prose with the finding and make NO tool call.",
    "Rules:",
    "- A pasted URL, short link, slug, email, or ID is a DATA lookup — use `query` to find it; never say you can't browse the web.",
    "- If a reference is ambiguous ('he', 'it', 'this', 'his project') with no clear antecedent in the conversation, call `clarify` — do not guess or invent an entity.",
    "- Verify an entity exists (via `query`) before reasoning about it. If a lookup returns no rows, say nothing was found — never describe an empty/NULL result as a real finding.",
    "- Be concise. Only state numbers/values present in query results; never invent data.",
    "",
    "Tables you can query (ask `query` in plain English; it knows the columns):",
    tableList,
  ].join("\n");
}

function historyToMessages(history: ConversationTurn[]): LLMToolMessage[] {
  const msgs: LLMToolMessage[] = [];
  for (const h of history) {
    msgs.push({ role: "user", content: h.question });
    msgs.push({
      role: "assistant",
      content: h.answer ? h.answer : h.ok ? "(answered with data)" : "(the previous attempt failed)",
    });
  }
  return msgs;
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDeps,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const maxSteps = deps.maxSteps ?? 6;
  const maxRows = deps.maxRows ?? 1000;

  try {
    const summaries = await deps.memory.getTableSummaries();
    const messages: LLMToolMessage[] = [
      { role: "system", content: buildSystemPrompt(summaries) },
      ...historyToMessages(input.history ?? []),
      { role: "user", content: input.question },
    ];
    const ctx: ToolContext = {
      reasoner: deps.reasoner,
      memory: deps.memory,
      execute: deps.execute,
      emit,
      userEmail: input.userEmail,
      maxRows,
    };
    let primaryLogId: string | null = null;

    for (let step = 0; step < maxSteps; step++) {
      emit({ type: "phase", phase: "working" });
      const turn = await deps.orchestrator.chatWithTools(messages, TOOL_DEFS);

      if (turn.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: turn.content ?? "",
          tool_calls: turn.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
        for (const call of turn.toolCalls) {
          const outcome = await dispatchTool(call, ctx);
          if (outcome.logId) primaryLogId = outcome.logId;
          messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
          if (outcome.clarify) {
            emit({ type: "narration", delta: outcome.clarify });
            emit({ type: "phase", phase: "done" });
            emit({ type: "done", logId: null });
            return;
          }
        }
        continue;
      }

      // No tool calls → V3's content is the final answer.
      const answer = (turn.content ?? "").trim();
      emit({ type: "narration", delta: answer || "I couldn't find an answer to that." });
      emit({ type: "phase", phase: "done" });
      emit({ type: "done", logId: primaryLogId });
      return;
    }

    emit({ type: "phase", phase: "error" });
    emit({
      type: "error",
      error: "I couldn't complete that within the step limit. Try narrowing the question.",
    });
  } catch (err) {
    emit({ type: "phase", phase: "error" });
    emit({ type: "error", error: err instanceof Error ? err.message : "Agent failed" });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: PASS (all 5 cases).

Note: `npx tsc --noEmit` will now FAIL because `route.ts` still passes the old deps (`fast`/`planner`) and `llm.ts` still exports now-unused `planMessage`/`selectTables`/`narrate`. That's expected — Tasks 5 and 6 fix it. Do NOT "fix" the route here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/loop.ts src/lib/integrations/ulink-agent/loop.test.ts
git commit -m "feat(agent): rewrite runAgent as a V3 tool-calling loop"
```

---

## Task 5: Remove the dead pipeline functions from `llm.ts`

**Files:**
- Modify: `src/lib/integrations/ulink-agent/llm.ts`
- Modify: `src/lib/integrations/ulink-agent/llm.test.ts`

`planMessage`, `selectTables`, `narrate`, and the `PlanResult` interface are now unused (the loop replaced them). Remove them. **Keep** `getPlannerClient` for now — `route.ts` still imports it until Task 6.

- [ ] **Step 1: Delete the functions**

In `src/lib/integrations/ulink-agent/llm.ts`, delete these four members entirely:
- `export async function selectTables(...) { ... }` (the whole function).
- `export interface PlanResult { ... }`.
- `export async function planMessage(...) { ... }` (the whole function).
- `export async function narrate(...) { ... }` (the whole function).

Keep `extractJson`, `generateSql`, `GenerateSqlInput`, `GeneratedSql`, `DEFAULT_CHART`, `parseSseLine`, `parseToolCalls`, `buildClient`, `getDeepSeekClient`, `getFastClient`, `getPlannerClient`, and all the tool-calling types/methods from Task 1.

- [ ] **Step 2: Update `llm.test.ts`**

In `src/lib/integrations/ulink-agent/llm.test.ts`:
- Change the import line to drop `selectTables` and `planMessage`:
  ```ts
  import { extractJson, generateSql, parseSseLine, parseToolCalls } from "./llm";
  ```
- Delete the entire `describe("selectTables", ...)` block and the entire `describe("planMessage", ...)` block.
- Keep the `extractJson`, `generateSql`, `parseSseLine`, and `parseToolCalls` describe blocks.

- [ ] **Step 3: Run tests + typecheck**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: still FAILS, but ONLY on `route.ts` (it imports/uses `getPlannerClient` + old deps). No errors referencing `planMessage`/`selectTables`/`narrate` should remain. If any other file references the deleted functions, that's a real miss — search with `grep -rn "planMessage\|selectTables\|\bnarrate\b" src` and fix.

- [ ] **Step 4: Commit**

```bash
git add src/lib/integrations/ulink-agent/llm.ts src/lib/integrations/ulink-agent/llm.test.ts
git commit -m "refactor(agent): remove dead pipeline functions (planMessage/selectTables/narrate)"
```

---

## Task 6: Wire the route to the new deps; remove `getPlannerClient`

**Files:**
- Modify: `src/app/api/agent/query/route.ts`
- Modify: `src/lib/integrations/ulink-agent/llm.ts`

- [ ] **Step 1: Update the route deps**

In `src/app/api/agent/query/route.ts`:

Change the import (line 3) from:
```ts
import { getDeepSeekClient, getFastClient, getPlannerClient } from "@/lib/integrations/ulink-agent/llm";
```
to:
```ts
import { getDeepSeekClient, getFastClient } from "@/lib/integrations/ulink-agent/llm";
```

Then change the `runAgent` deps object (currently `reasoner`/`fast`/`planner`/`memory`/`execute`) to:
```ts
            {
              orchestrator: getFastClient(),
              reasoner: getDeepSeekClient(),
              memory: supabaseMemory,
              execute: executeReadOnly,
            },
```
Leave everything else in the route unchanged (the `persist`/401 guard/`finally { controller.close() }`/event collection all stay).

- [ ] **Step 2: Remove `getPlannerClient` from `llm.ts`**

In `src/lib/integrations/ulink-agent/llm.ts`, delete the `getPlannerClient` function (and its preceding comment block) added earlier — nothing imports it anymore.

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit`
Expected: exit 0 (clean — no more route or dead-code errors).

Run: `npx vitest run`
Expected: all suites pass (loop, agent-tools, llm, validate, message, widgets, conversations, etc.).

- [ ] **Step 4: Verify no stale references**

Run: `grep -rn "getPlannerClient\|planMessage\|selectTables" src`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/query/route.ts src/lib/integrations/ulink-agent/llm.ts
git commit -m "feat(agent): wire query route to V3 orchestrator + R1 reasoner deps"
```

---

## Task 7: Full verification & finishing

- [ ] **Step 1: Full test + typecheck gate**

Run: `npx vitest run` (all suites green) and `npx tsc --noEmit` (exit 0).

- [ ] **Step 2: Manual end-to-end smoke (controller stops the dev server first, then builds/runs)**

The controller (not a subagent) stops the :3002 dev server, runs a clean `npm run build` to confirm production build is green, then `npm run dev -- -p 3002` and signs in to verify:
1. **Greeting** — "hi" → friendly reply, no result table (chat path via no-tool-call answer).
2. **Simple data** — "how many production subscriptions are active?" → runs `query`, shows a result + a prose answer; thinking panel shows the "Querying" step.
3. **The URL case** — "do you find this? https://qrcc.me/t592px9sk903" → it `query`s for the slug, finds nothing, and says it's not in the data (no phantom finding, no "can't browse").
4. **Ambiguity** — "is he churned?" with no prior entity → it calls `clarify` and asks which project/user.
5. **Multi-step** — "list churned projects and how many links the top one has" → multiple `query` calls; the final result table shows and the narration summarizes.
6. **Persistence + dashboards** — reload a conversation (renders sql/result/narration); pin a result to a dashboard; 👍 a turn (promotes the last query).

- [ ] **Step 3: Final code review + finishing**

Dispatch a final code reviewer over `main..feat/tool-calling-agent`, then use **superpowers:finishing-a-development-branch**. For finishing, follow the session norm: merge to `main` and push both remotes (origin = FlywheelStudio, mohn93). Update memory `project_pm_query_agent.md` with a v-note: pipeline replaced by a V3 tool-calling loop (`query`+`clarify`), R1 writes SQL inside `query`, same event protocol, `MAX_STEPS=6`, planMessage/selectTables/narrate/getPlannerClient removed.

---

## Notes for the implementer

- **Import DAG (acyclic):** `agent-tools.ts` → (`llm`, `validate`, `events`, `types`); `loop.ts` → (`agent-tools`, `llm`, `events`, `types`). `loop.ts` imports `ToolContext`/`TOOL_DEFS`/`dispatchTool` from `agent-tools.ts` — never the reverse.
- **Why `query` passes the full catalog to R1:** `selectTables` is gone, so `runQuery` fetches columns/FKs for *all* tables (`getColumnsForTables(allTableNames)`) and lets R1 pick. Acceptable prompt size for R1; revisit table-scoping only if it becomes a problem (YAGNI).
- **`generateSql` is unchanged** and still streams R1 reasoning — `runQuery` forwards it via the `reasoning` event, so the thinking panel still shows R1's thoughts during a query.
- **Event compatibility is the contract:** the loop emits `step`/`reasoning`/`sql`/`result`/`narration`/`done`/`error` exactly as before, so `use-agent-stream`, `AgentMessage`, persistence (`persistTurn`), pin-to-dashboard, and feedback need NO changes. The message reducer keeps the last `result`, giving "last result wins" for free.
- **`maxDuration = 60`** on the route is unchanged; a multi-`query` turn does V3 rounds + an R1 call each, so watch for timeouts and raise toward 300 (Pro/Fluid) or lower `MAX_STEPS` if needed.
- **Final-answer streaming — deliberate deviation from the spec.** The spec described the final answer as token-streamed `narration`. This plan makes `chatWithTools` non-streaming and emits the answer as a **single `narration` event**, because a turn can't be known to be "final" vs "a tool call" until the response completes (streaming content live risks emitting stray narration on tool-call turns). The answer still renders correctly (the reducer appends it); R1's reasoning *does* still stream into the thinking panel during `query`. Token-streaming the final answer (by detecting a content-first turn) is a safe future enhancement, intentionally deferred (YAGNI).
- **`new Date()`/etc.** are fine in this app code (the Workflow-script prohibition doesn't apply here).
```
