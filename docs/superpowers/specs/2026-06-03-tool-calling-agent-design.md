# Tool-Calling Agent Loop — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Project:** `flywheel_saas_dashboard` (Flywheel Command Center) — PM Data Agent

## Problem

The PM Data Agent's orchestration is a fixed 4-call pipeline:
`planMessage` (chat-vs-data) → `selectTables` → `generateSql` (≤3 retry) → `narrate`.
Each step is one LLM call decided up front, with no ability to look something up, see the
result, and change course. This causes the failures we observed:

- **Misrouting** — a pasted short link ("do you find this?") was classified as chat and
  refused ("I can't browse the web") instead of being looked up in `links`.
- **No anchor validation** — it bound an ambiguous "his project" to a stale slug that
  doesn't exist, never checked, and then **narrated an all-NULL phantom row as a real
  churned project**.
- **Lost intent across turns** — it couldn't see its own prior clarifying question.

Prompt guardrails + richer context (shipped 2026-06-03) patch the symptoms. This design
fixes the root cause: replace the rigid pipeline with a **tool-calling agent loop** where
one orchestrator model acts, observes results, and decides — including asking for
clarification and validating assumptions before concluding.

## Decisions (locked during brainstorming)

- **Shape:** A single tool-calling loop replaces the pipeline. The orchestrator model
  calls tools, sees results, and loops until it answers (capped).
- **Orchestrator model:** **V3 (`deepseek-chat`)** via **native OpenAI-style
  function-calling**. No new key; tool-native and fast. The loop compensates for V3's
  lower raw reasoning by letting it see results and self-correct. (R1 has no native
  function-calling; a frontier model was considered but parked.)
- **SQL authoring — hybrid:** V3 orchestrates in natural language; the **`query` tool
  delegates SQL writing to R1** (`generateSql`), preserving R1's SQL quality.
- **Tools:** `query`, `clarify`, optional `get_schema`. "Finish" is implicit (V3 emits
  text with no tool calls → that's the answer). No separate `narrate` call.
- **Rollout:** **Replace** the pipeline (one code path; `planMessage`/`selectTables`/
  `narrate` deleted). No parallel/flagged engine.
- **`MAX_STEPS = 6`** loop cap.
- **Event protocol unchanged** — the loop emits the same `AgentEvent`s, so chat UI,
  conversation persistence, dashboard pinning, and feedback keep working untouched.
- **Display:** "last result wins" — when a turn runs multiple `query()` calls, the
  displayed/persisted/pinnable table is the final query's result (matches today's
  single-result UI); the narration summarizes across queries.

## Architecture

`runAgent(input, deps, emit)` is rewritten from a pipeline into one loop. Reused
building blocks (unchanged): `validateSelect`, `executeReadOnly` (read-only pool),
`generateSql` (R1), the `pm_agent` catalog/examples/query_log, and the `AgentEvent`
streaming contract. Removed: `planMessage`, `selectTables`, `narrate`, `getPlannerClient`,
`PlanResult`.

### 1. The control loop

```
runAgent(input, deps, emit):
  messages = [
    systemPrompt(tableSummaries, guardrails),   // see §4
    ...historyAsMessages(input.history),         // includes prior assistant replies
    { role: "user", content: input.question },
  ]
  for step in 1..MAX_STEPS:
    emit({ type: "phase", phase: "working" })
    turn = await deps.orchestrator.chatWithTools(messages, TOOL_DEFS)   // V3
    if turn.toolCalls is non-empty:
      append assistant turn (with tool_calls) to messages
      for call in turn.toolCalls:
        emit a step describing the call
        result = await dispatchTool(call, deps, emit)   // executes; may emit sql/result
        append { role: "tool", tool_call_id: call.id, content: result } to messages
      continue
    else:
      // V3 produced the final answer (no tool calls)
      emit narration(turn.content); emit done(primaryLogId); return
  // cap exceeded
  emit error("Couldn't complete that within the step limit") + done(primaryLogId?)
```

- `clarify` is a terminal tool: when V3 calls it, the loop emits the question as
  `narration` and `done`, then returns (the turn ends awaiting the user) — it does **not**
  continue looping.
- `primaryLogId` = the logId of the **last successful `query()`** in the turn (for 👍).
- The final answer is **streamed** as `narration` for UX (the finish turn streams its
  content); tool-call rounds resolve without streaming and surface as `step`s.

### 2. Tools

Defined in a new `agent-tools.ts` (definitions + executors), so they're testable in
isolation. Each executor receives `(args, deps, emit)` and returns a string (the tool
result fed back to V3).

- **`query(question: string)`** — the workhorse (hybrid SQL).
  1. `gen = await generateSql(deps.reasoner /* R1 */, { question, columns, foreignKeys, examples })`
     — columns/FKs come from the catalog for tables R1 needs; examples from
     `getTrustedExamples()`.
  2. `v = validateSelect(gen.sql, MAX_ROWS)`; on `!v.ok` → return `{ error }` to V3.
  3. `result = await executeReadOnly(v.sql)`; on throw → return `{ error: message }`.
  4. Emit `sql` and `result` (with `gen.chart`) events. Log to `query_log` (success),
     capture logId as the turn's `primaryLogId`.
  5. Return to V3: `{ columns, rowCount, rows: rows.slice(0, 50), sql }` (JSON string).
     Errors return `{ error }` so V3 adapts within the step cap.

- **`clarify(question: string)`** — terminal. Emits `narration` (the question) + `done`;
  returns control. No data, no logId.

- **`get_schema(tables: string[])`** *(optional drill-down)* — returns columns + FKs for
  the named tables as a string. V3 already has table **summaries** in its system prompt;
  this is only for when it needs column-level detail to phrase a `query`. Included but
  minimal.

Malformed/invalid tool arguments → the dispatcher returns a tool error string ("invalid
arguments for <tool>") so V3 retries; the loop never throws on tool input.

### 3. Event protocol & downstream compatibility

The loop emits the **same `AgentEvent` union**, so `use-agent-stream`,
`AgentMessage`/`ResultView`, conversation persistence (`persistTurn` reduces events),
dashboard pinning, and 👍 feedback are **unchanged**:

| Loop action | Event(s) |
|---|---|
| V3 about to call a tool | `step` (e.g. `label:"Querying"`, `detail:<sub-question>`) |
| `query()` runs | `sql`, then `result` (columns/rows/chart) |
| V3 final text | streamed `narration` deltas |
| turn ends | `done` (logId = last successful query's) |
| `clarify` | `narration` (the question) + `done` |
| failure / cap | `error` |

- **Multiple `query()` calls:** each emits a `result`; the message reducer keeps the
  **last** one, so the displayed/persisted/pinnable table is the final query (no UI
  change). The narration summarizes across queries.
- **Thinking panel:** V3 is not a reasoning model, so the panel shows the **step log**
  (tool calls + sub-questions). Optional enhancement: stream R1's reasoning from inside
  `query()` into the panel via the existing `reasoning` event.

### 4. Orchestrator system prompt (domain + guardrails)

Built once per turn from the catalog and fixed guardrails:

- **Role:** "You answer questions about ULink's data by calling tools. Use `query` to get
  data (it writes and runs read-only SQL for you), `clarify` to ask the user when the
  request is ambiguous, and `get_schema` for column detail. When you have enough, reply
  with the answer in prose."
- **Domain:** the catalog **table summaries** (`getTableSummaries()`), so V3 knows what's
  queryable — including the two-level user model (ULink customers vs. their apps'
  end-users).
- **Guardrails** (carried over from the prompt-guardrails work):
  - A pasted URL/slug/email/ID is a **data lookup** — never refuse as "can't browse."
  - If a referent is **ambiguous** with no clear antecedent, call `clarify` — don't guess.
  - **Never present an empty/NULL result as a real finding** — say nothing was found.
  - Validate that an entity exists (via `query`) before reasoning about it.

### 5. Function-calling client

`LLMClient` (in `llm.ts`) gains a tool-calling method, e.g.:

```ts
interface ToolCall { id: string; name: string; arguments: string }
interface ToolDef { name: string; description: string; parameters: object } // JSON Schema
interface LLMClient {
  model: string;
  complete(messages): Promise<string>;
  stream(messages, handlers): Promise<string>;
  chatWithTools(
    messages: LLMToolMessage[],
    tools: ToolDef[],
    handlers?: { onContent?: (d: string) => void }
  ): Promise<{ content: string | null; toolCalls: ToolCall[] }>;
}
```

- Calls DeepSeek's OpenAI-compatible `/chat/completions` with `tools` + `tool_choice:"auto"`.
- `LLMToolMessage` extends `LLMMessage` with the `tool` role + `tool_call_id` and an
  assistant `tool_calls` field.
- For the **finish turn**, pass `onContent` to stream the answer as `narration`. Tool-call
  rounds can resolve non-streamed.
- Models: **orchestrator = `getFastClient()` (V3)**; **`query` tool = `getDeepSeekClient()`
  (R1)**. Both already exist.

### 6. Deps & route

`AgentDeps` becomes:
```ts
interface AgentDeps {
  orchestrator: LLMClient;  // V3, tool-calling
  reasoner: LLMClient;      // R1, used by the query tool
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxSteps?: number;        // default 6
}
```
`api/agent/query/route.ts` passes `orchestrator: getFastClient()`, `reasoner:
getDeepSeekClient()`, `memory: supabaseMemory`, `execute: executeReadOnly`. The `planner`
dep and `getPlannerClient` are removed. `persist`/`persist:false` logic, the 401 guard,
and the `finally { controller.close() }` are unchanged.

## Error handling

- **Tool failures are returned to V3**, not thrown — bad SQL, exec errors, and malformed
  tool args all come back as tool result strings so the model adapts within `MAX_STEPS`.
- **Cap exceeded** → emit `error` ("couldn't complete within the step limit"); include the
  last successful result if one exists.
- **All SQL** still passes `validateSelect` + the read-only pool + 15s statement timeout.
- **Top-level try/catch** emits an `error` event; the route's `finally` always closes the
  stream.
- **maxDuration = 60** retained (raise toward 300, or lower `MAX_STEPS`, if multi-query
  turns time out — V3 rounds + an R1 call per `query()`).

## Memory & feedback

- Each `query()` logs to `query_log` (its sub-question + SQL + success/row count). The
  turn's `done.logId` = the **last successful** query's log, so 👍 promotes a clean
  `(question, sql)` pair via the existing `promoteLogToExample`.
- Trusted examples still feed R1 inside `query()`; catalog/semantics unchanged and seed the
  orchestrator's system prompt. **No memory schema changes.**

## Testing (Vitest, pure logic with mocked clients — same approach as `loop.test.ts`)

- **Loop happy path:** mocked V3 returns `toolCalls` (a `query`) then final content →
  asserts the tool runs, the result is fed back, `sql`/`result`/`narration`/`done` are
  emitted in order, and `done.logId` is the query's.
- **Clarify:** V3 calls `clarify` → loop emits `narration` + `done` and stops (no further
  tool calls).
- **Cap:** V3 keeps returning tool calls → loop stops at `MAX_STEPS` and emits `error`.
- **Bad tool args:** dispatcher returns a tool error string; loop continues.
- **`query` tool:** mocked `generateSql` + `execute` → validates, emits `sql`/`result`,
  returns rows; on `validateSelect` failure or `execute` throw, returns `{ error }` and
  emits no `result`.
- Keep `validate`/`message`/`widgets`/`conversations` tests. Rewrite `loop.test.ts`. Trim
  `llm.test.ts` of `planMessage`/`selectTables`/`narrate` cases; keep `generateSql` +
  `extractJson` + `parseSseLine`; add a `chatWithTools` parse test (tool_calls extraction).

## Out of scope (YAGNI)

- A frontier orchestrator model / new provider (parked; revisit if V3 orchestration
  underperforms).
- Parallel/flagged engine (we replace outright).
- Multi-result display in the UI (last result wins; the narration covers the rest).
- New tools beyond `query`/`clarify`/`get_schema` (e.g. dedicated `lookup_link`) — `query`
  covers lookups.
- Memory/schema changes; dashboard or persistence changes (event protocol is stable).

## Files

- **Rewrite:** `src/lib/integrations/ulink-agent/loop.ts` (the tool-calling loop).
- **New:** `src/lib/integrations/ulink-agent/agent-tools.ts` (tool defs + executors).
- **Modify:** `src/lib/integrations/ulink-agent/llm.ts` — add `chatWithTools` (+ tool types)
  to the client; **keep** `generateSql`/`extractJson`/`parseSseLine`; **remove**
  `planMessage`, `selectTables`, `narrate`, `getPlannerClient`, `PlanResult`.
- **Modify:** `src/lib/integrations/ulink-agent/events.ts` — simplify `AgentPhase`
  (fewer fixed phases; `step` carries detail). Keep `step`/`sql`/`result`/`reasoning`/
  `narration`/`done`/`error`/`conversation`.
- **Modify:** `src/app/api/agent/query/route.ts` — new deps (`orchestrator`+`reasoner`,
  drop `planner`).
- **Modify tests:** rewrite `loop.test.ts`; trim `llm.test.ts`.
- **Unchanged:** `use-agent-stream.ts`, `agent-message.tsx`, `result-view.tsx`,
  conversation persistence, dashboards, feedback, memory schema.
