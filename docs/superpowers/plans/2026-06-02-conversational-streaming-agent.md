# Conversational Streaming Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the PM Query Agent into a conversational, streaming assistant — it answers chat without a table when appropriate, narrates query results in prose, and streams its tool steps + R1 reasoning live (auto-collapsing when done).

**Architecture:** Keep the deterministic, safe pipeline. Add a fast `deepseek-chat` planner (chat vs data), keep R1 for SQL generation (its reasoning is streamed as "thinking"), add a fast narration step (results → LLM). The loop becomes an event emitter; the API route streams NDJSON; a streaming hook + message UI render steps/reasoning/narration live.

**Tech Stack:** Next.js 14 (App Router, route streaming via `ReadableStream`), TypeScript, DeepSeek (R1 + chat, SSE streaming), Vitest, Tailwind/shadcn.

---

## Reference

Spec: `docs/superpowers/specs/2026-06-02-conversational-streaming-agent-design.md`. Read it first.

## File Structure

**New:**
- `src/lib/integrations/ulink-agent/events.ts` — `AgentEvent` union + `AgentPhase`.
- `src/hooks/use-agent-stream.ts` — streaming consumer hook + `applyEvent` reducer.
- `src/components/agent/agent-message.tsx` — renders one streamed message (thinking panel + narration + result + feedback).

**Modified:**
- `src/lib/integrations/ulink-agent/llm.ts` — add `model` + `stream()` to `LLMClient`, `parseSseLine`, `getFastClient`, `planMessage`, `narrate`; `generateSql` gains `onReasoning`.
- `src/lib/integrations/ulink-agent/llm.test.ts` — update stub to provide `stream`; add `planMessage` tests.
- `src/lib/integrations/ulink-agent/loop.ts` — replace `answerQuestion` with event-emitting `runAgent`.
- `src/lib/integrations/ulink-agent/loop.test.ts` — rewrite for `runAgent` event sequences.
- `src/app/api/agent/query/route.ts` — stream NDJSON.
- `src/app/(dashboard)/agent/page.tsx` — use `useAgentStream` + `AgentMessage`.
- `.env.example` — add `DEEPSEEK_FAST_MODEL`.

**Unchanged:** `validate.ts`, `client.ts`, `memory.ts`, `introspect.ts`, `result-view.tsx` (reused), `api/agent/feedback`, `api/agent/schema/refresh`. The old `use-agent-query.ts` is removed in Task 7.

---

## Task 1: Events type + env

**Files:**
- Create: `src/lib/integrations/ulink-agent/events.ts`
- Modify: `.env.example`

- [ ] **Step 1: Create the events module**

Create `src/lib/integrations/ulink-agent/events.ts`:
```ts
import type { ChartSpec } from "./types";

export type AgentPhase =
  | "planning"
  | "selecting"
  | "writing"
  | "running"
  | "narrating"
  | "done"
  | "error";

export type AgentEvent =
  | { type: "phase"; phase: AgentPhase }
  | { type: "step"; label: string; detail?: string }
  | { type: "reasoning"; delta: string }
  | { type: "sql"; sql: string }
  | {
      type: "result";
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      chart: ChartSpec | null;
    }
  | { type: "narration"; delta: string }
  | { type: "done"; logId: string | null }
  | { type: "error"; error: string };
```

- [ ] **Step 2: Add the fast-model env var**

Append to `.env.example` under the LLM section:
```bash
# Fast model for planning + narration (the slow reasoner stays on DEEPSEEK_MODEL)
DEEPSEEK_FAST_MODEL=deepseek-chat
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard && npx tsc --noEmit`
Expected: no errors.
```bash
git add src/lib/integrations/ulink-agent/events.ts .env.example
git commit -m "feat(agent): streaming AgentEvent types + DEEPSEEK_FAST_MODEL"
```

---

## Task 2: LLM streaming primitive + two clients (TDD)

**Files:**
- Modify: `src/lib/integrations/ulink-agent/llm.ts`
- Test: `src/lib/integrations/ulink-agent/llm.test.ts`

- [ ] **Step 1: Write the failing test for `parseSseLine`**

Add to `src/lib/integrations/ulink-agent/llm.test.ts` (new import + describe block):
```ts
import { parseSseLine } from "./llm";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: FAIL — `parseSseLine` is not exported.

- [ ] **Step 3: Implement streaming in `llm.ts`**

In `src/lib/integrations/ulink-agent/llm.ts`, replace the `LLMClient` interface and `getDeepSeekClient` with the following, and add the new exports. Find:
```ts
export interface LLMClient {
  complete(messages: LLMMessage[]): Promise<string>;
}

export function getDeepSeekClient(): LLMClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY must be set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  return {
    async complete(messages: LLMMessage[]): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: false }),
      });
      if (!res.ok) {
        throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM returned no content");
      return content;
    },
  };
}
```
Replace with:
```ts
export interface StreamHandlers {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface LLMClient {
  model: string;
  complete(messages: LLMMessage[]): Promise<string>;
  stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string>;
}

// Parse one SSE line ("data: {json}") into content/reasoning deltas.
// Returns null for keep-alives, [DONE], blank lines, and malformed JSON.
export function parseSseLine(
  line: string
): { content: string; reasoning: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta ?? {};
    return {
      content: typeof delta.content === "string" ? delta.content : "",
      reasoning:
        typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    };
  } catch {
    return null;
  }
}

function buildClient(model: string): LLMClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY must be set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  return {
    model,
    async complete(messages: LLMMessage[]): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: false }),
      });
      if (!res.ok) {
        throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM returned no content");
      return content;
    },
    async stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: true }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`LLM stream failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      const handle = (line: string) => {
        const parsed = parseSseLine(line);
        if (!parsed) return;
        if (parsed.reasoning) handlers.onReasoning?.(parsed.reasoning);
        if (parsed.content) {
          full += parsed.content;
          handlers.onContent?.(parsed.content);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
      }
      handle(buffer);
      return full;
    },
  };
}

export function getDeepSeekClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_MODEL || "deepseek-reasoner");
}

export function getFastClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_FAST_MODEL || "deepseek-chat");
}
```

- [ ] **Step 4: Update the existing `stubLLM` helper in the test to satisfy the new interface**

In `src/lib/integrations/ulink-agent/llm.test.ts`, find:
```ts
function stubLLM(response: string): LLMClient {
  return { complete: async () => response };
}
```
Replace with:
```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: PASS (parseSseLine cases + existing extractJson/selectTables/generateSql still green; `generateSql` is still on `complete` until Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/ulink-agent/llm.ts src/lib/integrations/ulink-agent/llm.test.ts
git commit -m "feat(agent): streaming LLM client (SSE) + fast/reasoner clients"
```

---

## Task 3: Planner, narrate, and streamed generateSql (TDD)

**Files:**
- Modify: `src/lib/integrations/ulink-agent/llm.ts`
- Test: `src/lib/integrations/ulink-agent/llm.test.ts`

- [ ] **Step 1: Write failing tests for `planMessage` and streamed `generateSql`**

Add to `src/lib/integrations/ulink-agent/llm.test.ts`:
```ts
import { planMessage } from "./llm";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: FAIL — `planMessage` not exported; `generateSql` doesn't accept a 3rd arg / doesn't stream reasoning.

- [ ] **Step 3: Add `PlanResult`/`planMessage`/`narrate` and make `generateSql` stream**

In `src/lib/integrations/ulink-agent/llm.ts`, add `QueryResult` to the type import at the top:
```ts
import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  ChartSpec,
  ConversationTurn,
  QueryResult,
  TableSummary,
} from "./types";
```

Add these exports (anywhere after `selectTables`):
```ts
export interface PlanResult {
  kind: "chat" | "data";
  reply?: string;
}

export async function planMessage(
  fast: LLMClient,
  question: string,
  history: ConversationTurn[],
  tables: TableSummary[]
): Promise<PlanResult> {
  const tableList = tables.map((t) => `- ${t.table}`).join("\n");
  const recent = history.map((h) => `Q: ${h.question}${h.ok ? "" : " (failed)"}`).join("\n");
  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are the planner for a ULink analytics assistant. Decide whether the user's " +
        "message needs a database query. Reply with ONLY JSON: " +
        '{"kind":"data"} if it asks about ULink data/metrics, or ' +
        '{"kind":"chat","reply":"..."} for greetings, thanks, clarifications, or general ' +
        "questions, where reply is a brief, friendly answer. If the user refers to a previous " +
        "question (e.g. 'try again', 'now by month'), treat it as data.",
    },
    {
      role: "user",
      content:
        `Message: ${question}\n` +
        (recent ? `Recent questions:\n${recent}\n` : "") +
        `\nAvailable tables:\n${tableList}`,
    },
  ];
  try {
    const raw = await fast.complete(messages);
    const parsed = extractJson(raw) as { kind?: string; reply?: string };
    if (parsed?.kind === "chat") {
      return {
        kind: "chat",
        reply:
          typeof parsed.reply === "string" && parsed.reply.trim()
            ? parsed.reply
            : "How can I help with your ULink data?",
      };
    }
    return { kind: "data" };
  } catch {
    return { kind: "data" };
  }
}

export async function narrate(
  fast: LLMClient,
  input: { question: string; sql: string; result: QueryResult },
  onContent: (delta: string) => void
): Promise<string> {
  const preview = {
    columns: input.result.columns,
    rowCount: input.result.rowCount,
    rows: input.result.rows.slice(0, 50),
  };
  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are a data analyst assistant for ULink. Given a question and its query results, " +
        "write a concise, friendly answer (1-4 sentences) stating the key numbers/findings. " +
        "Only use values present in the results; never invent data. Do not show SQL. " +
        "If rowCount is 0, say no matching data was found.",
    },
    {
      role: "user",
      content:
        `Question: ${input.question}\n\nResults (JSON, up to 50 rows):\n${JSON.stringify(preview)}`,
    },
  ];
  return fast.stream(messages, { onContent });
}
```

Then change `generateSql` to stream. Find its signature and the line that calls `llm.complete`:
```ts
export async function generateSql(
  llm: LLMClient,
  input: GenerateSqlInput
): Promise<GeneratedSql> {
```
Replace the signature with:
```ts
export async function generateSql(
  llm: LLMClient,
  input: GenerateSqlInput,
  onReasoning?: (delta: string) => void
): Promise<GeneratedSql> {
```
And find:
```ts
  const raw = await llm.complete(messages);
```
Replace with:
```ts
  const raw = await llm.stream(messages, { onReasoning });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/llm.test.ts`
Expected: PASS (planMessage + generateSql streaming + all prior).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` → no errors.
```bash
git add src/lib/integrations/ulink-agent/llm.ts src/lib/integrations/ulink-agent/llm.test.ts
git commit -m "feat(agent): planner, streamed narration, and reasoning-streaming generateSql"
```

---

## Task 4: Event-emitting `runAgent` loop (TDD)

**Files:**
- Modify: `src/lib/integrations/ulink-agent/loop.ts` (full rewrite)
- Test: `src/lib/integrations/ulink-agent/loop.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test for `runAgent`**

Replace the entire contents of `src/lib/integrations/ulink-agent/loop.test.ts` with:
```ts
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
    };
    const reasoner: LLMClient = { model: "r", complete: vi.fn(), stream: vi.fn() };
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
    };
    const reasoner: LLMClient = {
      model: "r",
      complete: vi.fn(),
      stream: async (_m, h) => {
        const out = '{"sql":"SELECT bad FROM links","chart":{"type":"none","xColumn":null,"yColumn":null}}';
        h.onContent?.(out);
        return out;
      },
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: FAIL — `runAgent` not exported (file still exports `answerQuestion`).

- [ ] **Step 3: Rewrite `loop.ts`**

Replace the entire contents of `src/lib/integrations/ulink-agent/loop.ts` with:
```ts
import { generateSql, narrate, planMessage, selectTables, type LLMClient } from "./llm";
import { validateSelect } from "./validate";
import type { AgentEvent } from "./events";
import type { ChartSpec, ConversationTurn, MemoryStore, QueryResult } from "./types";

export interface AgentDeps {
  reasoner: LLMClient;
  fast: LLMClient;
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxAttempts?: number;
}

export interface AgentInput {
  question: string;
  userEmail: string | null;
  history?: ConversationTurn[];
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDeps,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const maxRows = deps.maxRows ?? 1000;
  const maxAttempts = deps.maxAttempts ?? 3;
  const history = input.history ?? [];

  try {
    emit({ type: "phase", phase: "planning" });
    const summaries = await deps.memory.getTableSummaries();
    const plan = await planMessage(deps.fast, input.question, history, summaries);

    // --- chat path: no query, just a conversational reply ---
    if (plan.kind === "chat") {
      const reply = plan.reply ?? "How can I help with your ULink data?";
      emit({ type: "narration", delta: reply });
      const logId = await deps.memory.insertQueryLog({
        question: input.question,
        sql: null,
        attempts: 0,
        rowCount: null,
        success: true,
        error: null,
        userEmail: input.userEmail,
      });
      emit({ type: "phase", phase: "done" });
      emit({ type: "done", logId });
      return;
    }

    // --- data path ---
    emit({ type: "phase", phase: "selecting" });
    const tables = await selectTables(deps.fast, input.question, summaries, history);
    emit({ type: "step", label: "Selected tables", detail: tables.join(", ") });

    const [columns, foreignKeys, examples] = await Promise.all([
      deps.memory.getColumnsForTables(tables),
      deps.memory.getForeignKeysForTables(tables),
      deps.memory.getTrustedExamples(),
    ]);

    emit({ type: "phase", phase: "writing" });
    let priorError: string | null = null;
    let lastSql: string | null = null;
    let attempts = 0;
    let chart: ChartSpec | null = null;
    let result: QueryResult | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const gen = await generateSql(
          deps.reasoner,
          { question: input.question, columns, foreignKeys, examples, history, priorError },
          (delta) => emit({ type: "reasoning", delta })
        );
        chart = gen.chart;
        lastSql = gen.sql;

        const v = validateSelect(gen.sql, maxRows);
        if (!v.ok) {
          priorError = v.error ?? "Invalid SQL";
          emit({ type: "step", label: "Fixing query", detail: priorError });
          continue;
        }

        emit({ type: "phase", phase: "running" });
        result = await deps.execute(v.sql);
        break;
      } catch (err) {
        priorError = err instanceof Error ? err.message : String(err);
        emit({ type: "step", label: "Retrying", detail: priorError });
      }
    }

    if (!result) {
      await deps.memory.insertQueryLog({
        question: input.question,
        sql: lastSql,
        attempts,
        rowCount: null,
        success: false,
        error: priorError,
        userEmail: input.userEmail,
      });
      emit({ type: "phase", phase: "error" });
      emit({ type: "error", error: priorError ?? "Failed to answer the question" });
      return;
    }

    emit({ type: "sql", sql: lastSql! });
    emit({
      type: "result",
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      chart,
    });

    emit({ type: "phase", phase: "narrating" });
    await narrate(
      deps.fast,
      { question: input.question, sql: lastSql!, result },
      (delta) => emit({ type: "narration", delta })
    );

    const logId = await deps.memory.insertQueryLog({
      question: input.question,
      sql: lastSql,
      attempts,
      rowCount: result.rowCount,
      success: true,
      error: null,
      userEmail: input.userEmail,
    });
    emit({ type: "phase", phase: "done" });
    emit({ type: "done", logId });
  } catch (err) {
    emit({ type: "phase", phase: "error" });
    emit({ type: "error", error: err instanceof Error ? err.message : "Agent failed" });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/integrations/ulink-agent/loop.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/loop.ts src/lib/integrations/ulink-agent/loop.test.ts
git commit -m "feat(agent): event-emitting runAgent (planner + stream + narrate)"
```

---

## Task 5: Streaming API route

**Files:**
- Modify: `src/app/api/agent/query/route.ts` (full rewrite)

- [ ] **Step 1: Rewrite the route to stream NDJSON**

Replace the entire contents of `src/app/api/agent/query/route.ts` with:
```ts
import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { runAgent } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient, getFastClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";

export const dynamic = "force-dynamic";
// R1 is slow; the loop may make several calls. Allow up to 60s (raise on Pro/Fluid).
export const maxDuration = 60;

async function getUserEmail(request: NextRequest): Promise<string | null> {
  const session = request.cookies.get("fw_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  if (typeof body.question !== "string" || !body.question.trim()) {
    return new Response(JSON.stringify({ error: "question is required" }), { status: 400 });
  }
  const question = body.question;
  const history = Array.isArray(body.history)
    ? (body.history as ConversationTurn[]).slice(-5)
    : [];
  const userEmail = await getUserEmail(request);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(
          { question, userEmail, history },
          {
            reasoner: getDeepSeekClient(),
            fast: getFastClient(),
            memory: supabaseMemory,
            execute: executeReadOnly,
          },
          emit
        );
      } catch (err) {
        emit({
          type: "error",
          error: err instanceof Error ? err.message : "Agent failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit` → no errors.
```bash
git add src/app/api/agent/query/route.ts
git commit -m "feat(agent): stream NDJSON agent events from query route"
```

---

## Task 6: Streaming hook + event reducer (TDD)

**Files:**
- Create: `src/hooks/use-agent-stream.ts`
- Test: `src/hooks/use-agent-stream.test.ts`

- [ ] **Step 1: Write the failing test for `applyEvent`**

Create `src/hooks/use-agent-stream.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyEvent, emptyMessage } from "./use-agent-stream";

describe("applyEvent", () => {
  it("accumulates reasoning, steps, narration and finalizes on done", () => {
    let m = emptyMessage("m1", "how many links");
    m = applyEvent(m, { type: "phase", phase: "selecting" });
    m = applyEvent(m, { type: "step", label: "Selected tables", detail: "links" });
    m = applyEvent(m, { type: "reasoning", delta: "think " });
    m = applyEvent(m, { type: "reasoning", delta: "more" });
    m = applyEvent(m, { type: "sql", sql: "SELECT 1" });
    m = applyEvent(m, {
      type: "result",
      columns: ["n"],
      rows: [{ n: 5 }],
      rowCount: 1,
      chart: { type: "none", xColumn: null, yColumn: null },
    });
    m = applyEvent(m, { type: "narration", delta: "You have " });
    m = applyEvent(m, { type: "narration", delta: "5 links." });
    m = applyEvent(m, { type: "done", logId: "log-1" });

    expect(m.reasoning).toBe("think more");
    expect(m.steps).toHaveLength(1);
    expect(m.sql).toBe("SELECT 1");
    expect(m.result?.rowCount).toBe(1);
    expect(m.narration).toBe("You have 5 links.");
    expect(m.logId).toBe("log-1");
    expect(m.loading).toBe(false);
    expect(m.phase).toBe("done");
  });

  it("sets error and stops loading on error event", () => {
    let m = emptyMessage("m2", "q");
    m = applyEvent(m, { type: "error", error: "boom" });
    expect(m.error).toBe("boom");
    expect(m.loading).toBe(false);
    expect(m.phase).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/use-agent-stream.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement the hook + reducer**

Create `src/hooks/use-agent-stream.ts`:
```ts
"use client";

import { useState } from "react";
import type { AgentEvent, AgentPhase } from "@/lib/integrations/ulink-agent/events";
import type {
  ChartSpec,
  ConversationTurn,
  QueryResult,
} from "@/lib/integrations/ulink-agent/types";

export interface AgentStep {
  label: string;
  detail?: string;
}

export interface AgentMessage {
  id: string;
  question: string;
  phase: AgentPhase | "idle";
  reasoning: string;
  steps: AgentStep[];
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  narration: string;
  error: string | null;
  logId: string | null;
  loading: boolean;
  feedback: "up" | "down" | null;
}

export function emptyMessage(id: string, question: string): AgentMessage {
  return {
    id,
    question,
    phase: "idle",
    reasoning: "",
    steps: [],
    sql: null,
    chart: null,
    result: null,
    narration: "",
    error: null,
    logId: null,
    loading: true,
    feedback: null,
  };
}

export function applyEvent(m: AgentMessage, e: AgentEvent): AgentMessage {
  switch (e.type) {
    case "phase":
      return { ...m, phase: e.phase, loading: e.phase !== "done" && e.phase !== "error" };
    case "step":
      return { ...m, steps: [...m.steps, { label: e.label, detail: e.detail }] };
    case "reasoning":
      return { ...m, reasoning: m.reasoning + e.delta };
    case "sql":
      return { ...m, sql: e.sql };
    case "result":
      return {
        ...m,
        result: { columns: e.columns, rows: e.rows, rowCount: e.rowCount },
        chart: e.chart,
      };
    case "narration":
      return { ...m, narration: m.narration + e.delta };
    case "done":
      return { ...m, logId: e.logId, loading: false, phase: "done" };
    case "error":
      return { ...m, error: e.error, loading: false, phase: "error" };
    default:
      return m;
  }
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

export function useAgentStream() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  async function ask(question: string) {
    const id = nextId();
    const history: ConversationTurn[] = messages
      .filter((m) => !m.loading)
      .map((m) => ({
        question: m.question,
        sql: m.sql,
        ok: m.error === null,
        error: m.error,
      }));

    setMessages((prev) => [...prev, emptyMessage(id, question)]);

    const update = (fn: (m: AgentMessage) => AgentMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as AgentEvent;
          update((m) => applyEvent(m, event));
        } catch {
          /* skip malformed line */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      consume(buffer);
      update((m) => (m.loading ? { ...m, loading: false } : m));
    } catch {
      update((m) => ({
        ...m,
        loading: false,
        phase: "error",
        error: m.error ?? "Network error",
      }));
    }
  }

  async function sendFeedback(messageId: string, logId: string, helpful: boolean) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: helpful ? "up" : "down" } : m))
    );
    try {
      await fetch("/api/agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, helpful }),
      });
    } catch {
      /* best-effort */
    }
  }

  return { messages, ask, sendFeedback };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/use-agent-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-agent-stream.ts src/hooks/use-agent-stream.test.ts
git commit -m "feat(agent): streaming consumer hook + applyEvent reducer"
```

---

## Task 7: Message UI + page

**Files:**
- Create: `src/components/agent/agent-message.tsx`
- Modify: `src/app/(dashboard)/agent/page.tsx` (full rewrite)
- Delete: `src/hooks/use-agent-query.ts`

- [ ] **Step 1: Create the message component**

Create `src/components/agent/agent-message.tsx`:
```tsx
"use client";

import { useState } from "react";
import { ChevronRight, Loader2, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResultView } from "@/components/agent/result-view";
import type { AgentMessage as AgentMessageType } from "@/hooks/use-agent-stream";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";

const PHASE_LABEL: Record<string, string> = {
  idle: "Starting…",
  planning: "Thinking…",
  selecting: "Choosing tables…",
  writing: "Writing SQL…",
  running: "Running query…",
  narrating: "Composing answer…",
  done: "Done",
  error: "Error",
};

export function AgentMessage({
  message,
  onFeedback,
}: {
  message: AgentMessageType;
  onFeedback: (messageId: string, logId: string, helpful: boolean) => void;
}) {
  const finished = !message.loading;
  // Expanded while running; collapses once finished. User can re-open.
  const [open, setOpen] = useState(true);
  const showThinking = !open ? false : true;
  const hasThinking = message.steps.length > 0 || message.reasoning.length > 0;

  // Auto-collapse: when it finishes, default the panel closed (unless user opened).
  const [userToggled, setUserToggled] = useState(false);
  const panelOpen = userToggled ? open : !finished;

  const resultAnswer: AgentAnswer | null = message.result
    ? {
        ok: true,
        sql: message.sql,
        chart: message.chart,
        result: message.result,
        error: null,
        attempts: 0,
        logId: message.logId,
      }
    : null;

  return (
    <div className="space-y-3">
      {/* user question */}
      <div className="rounded-lg bg-accent/40 px-3 py-2 text-sm font-medium">
        {message.question}
      </div>

      {/* thinking panel */}
      {hasThinking && (
        <div className="rounded-lg border border-border/50">
          <button
            onClick={() => {
              setUserToggled(true);
              setOpen(!panelOpen);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {message.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", panelOpen && "rotate-90")}
              />
            )}
            {message.loading ? PHASE_LABEL[message.phase] ?? "Working…" : "Thinking"}
          </button>
          {panelOpen && (
            <div className="space-y-2 border-t border-border/50 px-3 py-2">
              {message.steps.map((s, i) => (
                <div key={i} className="text-xs">
                  <span className="text-foreground">{s.label}</span>
                  {s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
                </div>
              ))}
              {message.reasoning && (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/80">
                  {message.reasoning}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* error */}
      {message.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {message.error}
        </div>
      )}

      {/* narration */}
      {message.narration && (
        <div className="flex gap-2 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p className="whitespace-pre-wrap leading-relaxed">{message.narration}</p>
        </div>
      )}

      {/* result table/chart */}
      {resultAnswer && <ResultView answer={resultAnswer} />}

      {/* feedback */}
      {finished && !message.error && message.logId && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => onFeedback(message.id, message.logId!, true)}
            className={cn("rounded-md p-1.5 hover:bg-accent", message.feedback === "up" && "text-green-400")}
            aria-label="Helpful"
          >
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => onFeedback(message.id, message.logId!, false)}
            className={cn("rounded-md p-1.5 hover:bg-accent", message.feedback === "down" && "text-red-400")}
            aria-label="Not helpful"
          >
            <ThumbsDown className="h-4 w-4" />
          </button>
          {message.feedback === "up" && (
            <span className="text-xs text-muted-foreground">Saved as a trusted example</span>
          )}
        </div>
      )}
    </div>
  );
}
```

(Note: `showThinking` is intentionally unused-friendly — remove it if your linter flags it. The active control is `panelOpen`.)

- [ ] **Step 2: Rewrite the page to use the streaming hook**

Replace the entire contents of `src/app/(dashboard)/agent/page.tsx` with:
```tsx
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { AgentMessage } from "@/components/agent/agent-message";

export default function AgentPage() {
  const { messages, ask, sendFeedback } = useAgentStream();
  const [input, setInput] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void ask(q);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about ULink in plain English — it explains the answer and shows the data. Read-only.
        </p>
      </div>

      <div className="mt-6 flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            e.g. &ldquo;How many signups per week over the last 8 weeks?&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <AgentMessage key={m.id} message={m} onFeedback={sendFeedback} />
        ))}
      </div>

      <form onSubmit={submit} className="mt-auto flex gap-2 border-t border-border/50 pt-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about ULink data…"
          className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Delete the obsolete hook**

```bash
git rm src/hooks/use-agent-query.ts
```

- [ ] **Step 4: Remove the unused `showThinking`/`hasThinking` lint risk and verify build**

Edit `src/components/agent/agent-message.tsx`: delete the two lines
```tsx
  const showThinking = !open ? false : true;
  const hasThinking = message.steps.length > 0 || message.reasoning.length > 0;
```
and reintroduce `hasThinking` as a direct expression where used: change `{hasThinking && (` to:
```tsx
{(message.steps.length > 0 || message.reasoning.length > 0) && (
```

Run: `cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard && npm run build`
Expected: build succeeds; `/agent` route present. If Tremor/type issues appear, they are in `result-view.tsx` (unchanged) — do not modify.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/agent/page.tsx" src/components/agent/agent-message.tsx
git commit -m "feat(agent): streaming chat UI with collapsible thinking panel + narration"
```

---

## Task 8: Env wiring + full verification

**Files:** none (config + verification)

- [ ] **Step 1: Add `DEEPSEEK_FAST_MODEL` to local env**

Append to `.env.local` (gitignored):
```bash
DEEPSEEK_FAST_MODEL=deepseek-chat
```

- [ ] **Step 2: Add it to Vercel (Production + Development)**

Run:
```bash
cd /Users/mohn93/Desktop/flywheel/flywheel_saas_dashboard
printf '%s' 'deepseek-chat' | npx vercel env add DEEPSEEK_FAST_MODEL production
printf '%s' 'deepseek-chat' | npx vercel env add DEEPSEEK_FAST_MODEL development
npx vercel env ls | grep DEEPSEEK_FAST_MODEL
```
Expected: present in Production and Development.

- [ ] **Step 3: Full unit suite + lint**

Run: `npx vitest run` → all pass (parseSseLine, planMessage, generateSql streaming, runAgent ×3, applyEvent ×2, plus existing validate/ga/ulink tests).
Run: `npm run lint` → clean.

- [ ] **Step 4: Restart dev server (pinned to 3002) and smoke-test**

Stop the running server and start fresh so the new env loads. Then in the browser at `http://localhost:3002` → PM Agent:
1. Type "hello" → expect a fast (~1-2s) conversational reply, **no table**, thinking panel minimal.
2. Ask "how many links were created in the last 7 days?" → expect: thinking panel shows "Choosing tables → links", streamed R1 reasoning, then a prose answer + the table; panel auto-collapses when done.
3. Ask a follow-up "now per day" → expect it builds on the prior question.
4. 👍 a good answer → confirms it persists to `pm_agent.examples`.

- [ ] **Step 5: Commit any final notes (none expected)**

```bash
git add -A && git commit -m "chore(agent): enable DEEPSEEK_FAST_MODEL" || echo "nothing to commit"
```

---

## Definition of Done

- `npx vitest run` green; `npm run lint` clean; `npm run build` succeeds.
- "hello" returns a conversational reply with no table; data questions stream reasoning + steps, then narrate the result in prose with the table, and the thinking panel auto-collapses.
- Follow-ups (including after a failure) work via conversation history.
- `DEEPSEEK_FAST_MODEL` set locally and on Vercel (prod + dev).
