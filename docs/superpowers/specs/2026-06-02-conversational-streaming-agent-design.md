# Conversational Streaming Agent — Design

**Date:** 2026-06-02
**Status:** Approved (pre-implementation)
**Location:** `flywheel_saas_dashboard` — PM Query Agent (`/agent`)
**Supersedes:** the "render rows, no LLM summary" privacy stance in `2026-06-01-ulink-pm-query-agent-design.md` (owner has explicitly opted into sending results to the LLM for this internal tool).

## Problem

The current agent is a mute NL→SQL→table tool: it always forces a SQL query and never sends results back to the model, so it can't converse, can't skip the table when one isn't needed, and shows no visible "thinking." The owner wants an **assistant**: it should answer conversationally (sometimes with no table), narrate query results in prose, and **stream its thinking + tool steps live**, collapsing them once the final answer is ready.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Narrate results in prose? | **Yes** — query results are sent to the LLM (supersedes prior privacy choice; internal tool) |
| Steps UX | **Stream live**, auto-collapse the thinking panel when done |
| Steps content | **Tool steps + R1 reasoning** (chain-of-thought) |
| Architecture | Streaming **orchestrated** agent (keep deterministic pipeline; not native tool-calling) |
| Models | R1 (`DEEPSEEK_MODEL`) for SQL generation; `deepseek-chat` (`DEEPSEEK_FAST_MODEL`) for planning, table-selection, narration |
| Transport | NDJSON stream (one JSON event per line) over a `ReadableStream` response |

Approach C (native tool-calling on `deepseek-chat`) was rejected because R1 doesn't reliably support function-calling and switching off R1 loses the SQL quality just gained.

## Models / env

- New env var `DEEPSEEK_FAST_MODEL=deepseek-chat` (added to `.env.example` and Vercel prod/dev).
- Two LLM clients:
  - **reasoner** — `DEEPSEEK_MODEL` (deepseek-reasoner / R1): SQL generation only (its reasoning is the visible "thinking"; ~10–30s).
  - **fast** — `DEEPSEEK_FAST_MODEL` (deepseek-chat): planning, table-selection, narration (~1–3s).
- Rationale: a plain "hello" returns in ~1s (fast model), and only the SQL step pays R1 latency.

## Streaming protocol (NDJSON)

Each line is one JSON event:

```
{"type":"phase",     "phase":"planning|selecting|writing|running|narrating|done"}
{"type":"step",      "label":"...", "detail":"..."}     // e.g. "Selected tables" / "projects, subscriptions"
{"type":"reasoning", "delta":"..."}                      // R1 chain-of-thought chunk
{"type":"sql",       "sql":"SELECT ..."}                  // final VALIDATED sql
{"type":"result",    "columns":[...], "rows":[...], "rowCount":N, "chart":{...}}
{"type":"narration", "delta":"..."}                       // prose answer chunk
{"type":"done",      "logId":"<uuid>"}
{"type":"error",     "error":"..."}
```

The shared `AgentEvent` union lives in `src/lib/integrations/ulink-agent/events.ts` and is imported by both the server emitter and the client parser.

## Agent flow (`runAgent(input, deps, emit)`)

`input = { question, userEmail, history }`. `deps = { reasoner, fast, memory, execute, maxRows?, maxAttempts? }`. `emit(event: AgentEvent)` enqueues onto the stream.

1. `phase: planning`. **Plan** (fast): given the message + history + table summaries, classify `kind: "chat" | "data"`; for `chat`, also produce a `reply`.
2. **chat path:** stream the reply as `narration` deltas → log to `query_log` (success=true, sql=null) → `done`. No query runs, no table.
3. **data path:**
   - `phase: selecting`; `selectTables` (fast, history-aware) → `step` "Selected tables".
   - `phase: writing`; attempt loop (≤ `maxAttempts`, default 3):
     - `generateSql` (R1) streaming → emit `reasoning` deltas as they arrive; returns `{sql, chart}`.
     - `validateSelect` → on reject, emit `step` "Fixing query" + retry with the error fed back.
     - `phase: running`; `executeReadOnly(validatedSql)` → on DB error, emit `step` "Retrying" + retry.
   - emit `sql` (validated) and `result` (columns/rows/rowCount + chart).
   - `phase: narrating`; `narrate(question, result, sql)` (fast) streaming → emit `narration` deltas (results sent to LLM).
   - `insertQueryLog(success=true)` → emit `done` with `logId`.
4. On unrecoverable failure: `insertQueryLog(success=false, error)` → emit `error`.

The read-only execution path, validator, and `pm_agent` memory are unchanged.

## Components

**`src/lib/integrations/ulink-agent/llm.ts`** (extend):
- `streamComplete(messages, handlers: { onReasoning?, onContent? }, model): Promise<string>` — POSTs with `stream:true`, parses SSE chunks, invokes `onReasoning(delta)` for `choices[0].delta.reasoning_content` and `onContent(delta)` for `choices[0].delta.content`, returns the full concatenated content.
- `getReasonerClient()` (existing `getDeepSeekClient`, renamed/aliased) and `getFastClient()` (uses `DEEPSEEK_FAST_MODEL`).
- `planMessage(fast, question, history, tableSummaries): Promise<{ kind, reply? }>` (non-streaming JSON classify; `reply` for chat).
- `narrate(fast, { question, sql, result }, onContent): Promise<string>` — streamed prose; the system prompt forbids inventing numbers not present in the rows.
- `generateSql` gains an optional `onReasoning` callback and uses `streamComplete` on the reasoner.
- `selectTables` runs on the fast client.

**`src/lib/integrations/ulink-agent/events.ts`** (new): the `AgentEvent` union + `AgentPhase` type.

**`src/lib/integrations/ulink-agent/loop.ts`** → `runAgent(input, deps, emit)` (event-emitting; replaces `answerQuestion`'s return-based shape). Keeps the retry loop and logging.

**`src/app/api/agent/query/route.ts`**: returns `new Response(readableStream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } })`. In `start(controller)`, runs `runAgent` with `emit = e => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))`, closes on done/error. `export const maxDuration = 60` stays.

**`src/hooks/use-agent-stream.ts`** (new, replaces `use-agent-query.ts`): `ask(question)` POSTs, reads `response.body` via a reader, splits on newlines, parses events, and incrementally updates the message:
```ts
interface AgentMessage {
  id: string;
  question: string;
  phase: AgentPhase;
  reasoning: string;     // accumulated
  steps: { label: string; detail?: string }[];
  sql: string | null;
  chart: ChartSpec | null;
  result: QueryResult | null;
  narration: string;     // accumulated
  error: string | null;
  logId: string | null;
  loading: boolean;
  feedback: "up" | "down" | null;
}
```
`sendFeedback(messageId, logId, helpful)` unchanged (calls `/api/agent/feedback`). History for the next turn keeps `{ question, sql, ok, error }` (already implemented).

**UI:**
- `src/components/agent/agent-message.tsx` (new): renders one `AgentMessage` — a **"Thinking" panel** (the step timeline + streaming `reasoning` in muted monospace), expanded while `loading`, **auto-collapsed when `phase === "done"`** (toggle to re-expand) → **narration** prose (plain text, streams in) → **`ResultView`** (existing) when `result` is present → 👍/👎.
- `src/app/(dashboard)/agent/page.tsx`: uses `useAgentStream`, renders `AgentMessage` per turn.
- `src/components/agent/result-view.tsx`: unchanged (already does collapse-to-4 + humanized dates); reused for the table/chart block.

## Error handling

- LLM/stream/network errors → `error` event → red box (reuse existing styling); the turn is logged `success=false`.
- In-loop validator rejects and DB errors retry (≤3) and surface as steps; exhaustion → `error`.
- Client navigation/abort closes the reader; the server `start`/`cancel` stops `runAgent`.
- Malformed NDJSON line on the client → skipped defensively (don't crash the stream).

## Testing (Vitest)

- **SSE parser** in `streamComplete`: feed fabricated chunk strings (split mid-token, `reasoning_content` then `content`) → assert reconstructed reasoning + content and callback calls.
- **`planMessage`**: stubbed fast client returning JSON → asserts `chat` vs `data` classification and `reply` extraction; falls back to `data` on parse failure.
- **`runAgent`**: stubbed reasoner/fast/execute/memory + a capturing `emit`; assert the event sequence for (a) the chat path (no `result`, has `narration`+`done`) and (b) the data path (`selecting`→`writing`→`running`→`result`→`narration`→`done`, with `logId`). No DB or network.
- Existing validator/loop tests adapted to `runAgent`.
- Streaming route + UI verified manually on `localhost:3002`.

## Out of scope (YAGNI)

Markdown rendering of narration (plain text first); native multi-tool/agentic planning; chart types beyond the current spec; persisting reasoning/steps to `query_log` (still logs question/sql/success/error only); SSE protocol niceties (plain NDJSON is enough).

## Prerequisites

- Add `DEEPSEEK_FAST_MODEL=deepseek-chat` to `.env.local`, `.env.example`, and Vercel (prod + dev).
