# ULink Agent Performance Guardrails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the ULink PM Data Agent from silently running expensive queries by adding an EXPLAIN cost-gate with human "run anyway" confirmation, tighter DB resource limits, and per-user rate limiting.

**Architecture:** Before executing generated SQL, run `EXPLAIN (FORMAT JSON)` (plans only, never executes) and read estimated cost/rows. Cheap queries run as today. Over-budget queries are stashed in Redis under a token; the stream emits a `confirm_required` event and stops. The user clicks "Run anyway", which POSTs the token to a new `/api/agent/confirm` route that re-validates and executes the exact stored SQL, then narrates the result. A `ULINK_AGENT_GATE_ENABLED` flag ships the gate in shadow mode (log cost/rows, never block) for threshold calibration before blocking is turned on. Separately, tighten the read-only pool's statement timeout, add DB-role-level limits, and add a fixed-window per-user rate limit.

**Tech Stack:** Next.js 14 App Router (route handlers, NDJSON streaming), TypeScript, `pg` (read-only pool), `@upstash/redis`, DeepSeek via the existing `LLMClient`, vitest for unit tests.

**Note on stale docs:** `CLAUDE.md` says "No test framework is configured" — that is outdated. `package.json` defines `"test": "vitest run"` and vitest is in devDependencies. This plan uses vitest for the pure-logic units. `@upstash/ratelimit` is NOT installed; the rate limiter is implemented directly on `@upstash/redis` to avoid a new dependency.

---

## File Structure

**New files:**
- `src/lib/integrations/ulink-agent/explain.ts` — EXPLAIN cost estimation: pure parse + budget logic + `estimateCost()` runner + env config.
- `src/lib/integrations/ulink-agent/explain.test.ts` — unit tests for the pure functions.
- `src/lib/integrations/ulink-agent/pending.ts` — stash/take a pending gated query in Redis, scoped to user email.
- `src/lib/integrations/ulink-agent/ratelimit.ts` — fixed-window per-user rate limit + `parseWindow()`.
- `src/lib/integrations/ulink-agent/ratelimit.test.ts` — unit tests for `parseWindow()`.
- `src/lib/integrations/ulink-agent/narrate.ts` — one-shot result narration via the fast LLM client.
- `src/app/api/agent/confirm/route.ts` — execute a confirmed (stashed) query and stream the result.
- `supabase/ulink_agent_perf_guardrails.sql` — `query_log` cost columns + `pm_readonly` role limits.

**Modified files:**
- `src/lib/cache/kv.ts` — export the shared `getRedis()`.
- `src/lib/integrations/ulink-agent/types.ts` — `QueryLogEntry` gains `estCost`/`estRows`.
- `src/lib/integrations/ulink-agent/memory.ts` — persist `est_cost`/`est_rows`.
- `src/lib/integrations/ulink-agent/events.ts` — add `confirm_required` event.
- `src/lib/integrations/ulink-agent/agent-tools.ts` — `ToolContext` gains `conversationId`; `runQuery` gates after validate; `ToolOutcome` gains `confirm`.
- `src/lib/integrations/ulink-agent/loop.ts` — `AgentInput`/ctx thread `conversationId`; handle `confirm` like `clarify`.
- `src/lib/integrations/ulink-agent/client.ts` — env-driven statement timeout + pool sizing.
- `src/lib/integrations/ulink-agent/message.ts` — `AgentMessage.pending` + `applyEvent` handles `confirm_required`.
- `src/app/api/agent/query/route.ts` — rate limit; thread `conversationId` into the agent; skip persist on a confirm-only turn.
- `src/hooks/use-agent-stream.ts` — handle `confirm_required`; add `confirm(messageId, token)`; surface rate-limit 429.
- `src/components/agent/agent-message.tsx` — render the confirm card.
- `src/app/(dashboard)/agent/page.tsx` — pass `confirm` down to `AgentMessage`.
- `.env.example` — new env vars + read-replica requirement.
- `README.md` — read-replica requirement + new env vars.

---

## Task 1: query_log cost columns + types + memory

**Files:**
- Create: `supabase/ulink_agent_perf_guardrails.sql`
- Modify: `src/lib/integrations/ulink-agent/types.ts:70-78`
- Modify: `src/lib/integrations/ulink-agent/memory.ts:71-87`

- [ ] **Step 1: Write the SQL migration (cost columns)**

Create `supabase/ulink_agent_perf_guardrails.sql`:

```sql
-- ULink Agent performance guardrails.
-- 1) Shadow-mode logging: record the EXPLAIN estimate for every query.
alter table pm_agent.query_log
  add column if not exists est_cost double precision,
  add column if not exists est_rows double precision;

-- 2) DB-level resource limits on the agent's read-only role (belt-and-suspenders;
--    the app also sets these per-connection). Adjust work_mem to taste.
alter role pm_readonly set statement_timeout = '8s';
alter role pm_readonly set work_mem = '32MB';
```

- [ ] **Step 2: Extend `QueryLogEntry`**

In `src/lib/integrations/ulink-agent/types.ts`, replace the `QueryLogEntry` interface (lines 70-78):

```typescript
export interface QueryLogEntry {
  question: string;
  sql: string | null;
  attempts: number;
  rowCount: number | null;
  success: boolean;
  error: string | null;
  userEmail: string | null;
  estCost?: number | null;
  estRows?: number | null;
}
```

- [ ] **Step 3: Persist the new columns in `insertQueryLog`**

In `src/lib/integrations/ulink-agent/memory.ts`, in `insertQueryLog` (the `.insert({...})` object, lines 74-82), add two fields after `user_email: entry.userEmail,`:

```typescript
        user_email: entry.userEmail,
        est_cost: entry.estCost ?? null,
        est_rows: entry.estRows ?? null,
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no type errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/ulink_agent_perf_guardrails.sql src/lib/integrations/ulink-agent/types.ts src/lib/integrations/ulink-agent/memory.ts
git commit -m "feat(agent): query_log cost columns + pm_readonly role limits"
```

> Apply `supabase/ulink_agent_perf_guardrails.sql` against the ULink database as a separate ops step (it is not run automatically).

---

## Task 2: EXPLAIN cost estimation module (TDD)

**Files:**
- Create: `src/lib/integrations/ulink-agent/explain.ts`
- Test: `src/lib/integrations/ulink-agent/explain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/integrations/ulink-agent/explain.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseExplainResult, exceedsBudget, type CostEstimate } from "./explain";

describe("parseExplainResult", () => {
  it("reads Total Cost and Plan Rows from EXPLAIN (FORMAT JSON) output", () => {
    // pg returns one row whose single column holds the JSON plan array.
    const rows = [
      { "QUERY PLAN": [{ Plan: { "Total Cost": 12345.6, "Plan Rows": 4200 } }] },
    ];
    expect(parseExplainResult(rows)).toEqual({ cost: 12345.6, rows: 4200 });
  });

  it("handles the plan already being an object (driver-parsed)", () => {
    const rows = [{ "QUERY PLAN": { Plan: { "Total Cost": 1, "Plan Rows": 2 } } }];
    expect(parseExplainResult(rows)).toEqual({ cost: 1, rows: 2 });
  });

  it("returns null when the shape is unrecognized", () => {
    expect(parseExplainResult([{ foo: "bar" }])).toBeNull();
    expect(parseExplainResult([])).toBeNull();
  });
});

describe("exceedsBudget", () => {
  const est: CostEstimate = { cost: 1000, rows: 1000 };
  it("trips when cost exceeds the cost limit", () => {
    expect(exceedsBudget(est, { maxCost: 500, maxRows: 100000 })).toBe(true);
  });
  it("trips when rows exceed the row limit", () => {
    expect(exceedsBudget(est, { maxCost: 100000, maxRows: 500 })).toBe(true);
  });
  it("does not trip when both are within budget", () => {
    expect(exceedsBudget(est, { maxCost: 100000, maxRows: 100000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/explain.test.ts`
Expected: FAIL — cannot resolve `./explain` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/integrations/ulink-agent/explain.ts`:

```typescript
import type { QueryResult } from "./types";

export interface CostEstimate {
  cost: number;
  rows: number;
}

export interface Budget {
  maxCost: number;
  maxRows: number;
}

// Read { "Total Cost", "Plan Rows" } from the top node of EXPLAIN (FORMAT JSON).
// pg may hand the JSON back as a string, an array, or an object depending on
// driver settings, so normalize all three.
export function parseExplainResult(rows: Record<string, unknown>[]): CostEstimate | null {
  const first = rows[0];
  if (!first) return null;
  let plan: unknown = first["QUERY PLAN"];
  if (typeof plan === "string") {
    try {
      plan = JSON.parse(plan);
    } catch {
      return null;
    }
  }
  const node = Array.isArray(plan) ? plan[0] : plan;
  const top = (node as { Plan?: unknown } | null)?.Plan as
    | { "Total Cost"?: unknown; "Plan Rows"?: unknown }
    | undefined;
  if (!top) return null;
  const cost = top["Total Cost"];
  const planRows = top["Plan Rows"];
  if (typeof cost !== "number" || typeof planRows !== "number") return null;
  return { cost, rows: planRows };
}

export function exceedsBudget(est: CostEstimate, budget: Budget): boolean {
  return est.cost > budget.maxCost || est.rows > budget.maxRows;
}

// Env-driven config. Defaults are effectively "off" so the gate ships in shadow
// mode (log only) until ULINK_AGENT_GATE_ENABLED=true and thresholds are tuned.
export function gateConfig(): { enabled: boolean; budget: Budget } {
  return {
    enabled: process.env.ULINK_AGENT_GATE_ENABLED === "true",
    budget: {
      maxCost: Number(process.env.ULINK_AGENT_MAX_PLAN_COST ?? Number.MAX_SAFE_INTEGER),
      maxRows: Number(process.env.ULINK_AGENT_MAX_PLAN_ROWS ?? Number.MAX_SAFE_INTEGER),
    },
  };
}

// Run EXPLAIN (no ANALYZE — plans only, never executes) and parse the estimate.
// Returns null if EXPLAIN fails or the output can't be parsed; callers treat a
// null estimate as "don't gate" (fail open — statement_timeout is the backstop).
export async function estimateCost(
  execute: (sql: string) => Promise<QueryResult>,
  wrappedSql: string
): Promise<CostEstimate | null> {
  try {
    const res = await execute(`EXPLAIN (FORMAT JSON) ${wrappedSql}`);
    return parseExplainResult(res.rows);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/integrations/ulink-agent/explain.test.ts`
Expected: PASS (all 6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/explain.ts src/lib/integrations/ulink-agent/explain.test.ts
git commit -m "feat(agent): EXPLAIN cost estimation + budget gate logic"
```

---

## Task 3: shared Redis + pending-query stash

**Files:**
- Modify: `src/lib/cache/kv.ts:5-12`
- Create: `src/lib/integrations/ulink-agent/pending.ts`

- [ ] **Step 1: Export the shared Redis client**

In `src/lib/cache/kv.ts`, change the `getRedis` declaration (line 7) from `function getRedis()` to an exported function:

```typescript
export function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}
```

- [ ] **Step 2: Write the pending-query stash**

Create `src/lib/integrations/ulink-agent/pending.ts`:

```typescript
import { randomUUID } from "crypto";
import { getRedis } from "@/lib/cache/kv";
import type { ChartSpec, DisplayMode } from "./types";

const TTL_SECONDS = 5 * 60; // a confirmation prompt is short-lived

export interface PendingQuery {
  rawSql: string; // the model's SQL, for display + logging
  wrappedSql: string; // the validated, executable (LIMIT-wrapped) SQL
  chart: ChartSpec;
  question: string;
  display: DisplayMode;
  estCost: number;
  estRows: number;
  userEmail: string | null;
  conversationId: string | null;
}

function key(token: string): string {
  return `agent:pending:${token}`;
}

export async function stashPending(p: PendingQuery): Promise<string> {
  const token = randomUUID();
  await getRedis().set(key(token), p, { ex: TTL_SECONDS });
  return token;
}

// One-shot retrieval scoped to the caller's email. Deletes the token so a
// confirmation can't be replayed. Returns null if missing/expired or if the
// requester is not the user who created it.
export async function takePending(
  token: string,
  requesterEmail: string | null
): Promise<PendingQuery | null> {
  const redis = getRedis();
  const p = await redis.get<PendingQuery>(key(token));
  if (!p) return null;
  if (p.userEmail !== requesterEmail) return null;
  await redis.del(key(token));
  return p;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cache/kv.ts src/lib/integrations/ulink-agent/pending.ts
git commit -m "feat(agent): shared redis export + pending-query stash"
```

---

## Task 4: confirm_required event + gate wiring

**Files:**
- Modify: `src/lib/integrations/ulink-agent/events.ts:5-21`
- Modify: `src/lib/integrations/ulink-agent/agent-tools.ts:67-80` (ToolContext/ToolOutcome), `:82-175` (runQuery)
- Modify: `src/lib/integrations/ulink-agent/loop.ts:15-19` (AgentInput), `:79-113` (ctx + confirm handling)
- Modify: `src/app/api/agent/query/route.ts:48-80`

- [ ] **Step 1: Add the `confirm_required` event**

In `src/lib/integrations/ulink-agent/events.ts`, add a member to the `AgentEvent` union (after the `result` member, before `narration`):

```typescript
  | {
      type: "confirm_required";
      token: string;
      estCost: number;
      estRows: number;
      sql: string;
      question: string;
    }
```

- [ ] **Step 2: Extend `ToolContext` and `ToolOutcome`**

In `src/lib/integrations/ulink-agent/agent-tools.ts`, add `conversationId` to `ToolContext` (after `userEmail: string | null;`, line 72):

```typescript
  userEmail: string | null;
  conversationId: string | null;
  maxRows: number;
```

And add a `confirm` field to `ToolOutcome` (after the `clarify?` line, line 79):

```typescript
  clarify?: string; // set by clarify → the loop terminates, asking this question
  confirm?: {
    token: string;
    estCost: number;
    estRows: number;
    sql: string;
    question: string;
  }; // set when the cost-gate trips → the loop terminates, asking the user to confirm
```

- [ ] **Step 3: Wire the gate into `runQuery`**

In `src/lib/integrations/ulink-agent/agent-tools.ts`, add imports at the top (after the existing `validate` import, line 2):

```typescript
import { estimateCost, exceedsBudget, gateConfig } from "./explain";
import { stashPending } from "./pending";
```

Then, in `runQuery`, replace the block from the `ctx.emit({ type: "sql", ... })` line through the `execute` try/catch (currently lines 127-145) with:

```typescript
  ctx.emit({ type: "sql", sql: gen.sql });

  // Cost-gate: EXPLAIN (plan only) before running. In shadow mode we log the
  // estimate but never block; with the gate enabled an over-budget query is
  // stashed and the user is asked to confirm.
  const estimate = await estimateCost(ctx.execute, v.sql);
  const { enabled, budget } = gateConfig();
  if (enabled && estimate && exceedsBudget(estimate, budget)) {
    const token = await stashPending({
      rawSql: gen.sql,
      wrappedSql: v.sql,
      chart: gen.chart,
      question,
      display,
      estCost: estimate.cost,
      estRows: estimate.rows,
      userEmail: ctx.userEmail,
      conversationId: ctx.conversationId,
    });
    await ctx.memory.insertQueryLog({
      question,
      sql: gen.sql,
      attempts: 1,
      rowCount: null,
      success: false,
      error: "gated: estimated cost over budget (awaiting confirmation)",
      userEmail: ctx.userEmail,
      estCost: estimate.cost,
      estRows: estimate.rows,
    });
    return {
      content: JSON.stringify({
        gated: true,
        message: "Query is estimated to be expensive; awaiting user confirmation.",
      }),
      confirm: {
        token,
        estCost: estimate.cost,
        estRows: estimate.rows,
        sql: gen.sql,
        question,
      },
    };
  }

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
      estCost: estimate?.cost ?? null,
      estRows: estimate?.rows ?? null,
    });
    return { content: JSON.stringify({ error }) };
  }
```

Then update the success-path `insertQueryLog` call (the one after the `result` emit, originally lines 156-164) to include the estimate:

```typescript
  const logId = await ctx.memory.insertQueryLog({
    question,
    sql: gen.sql,
    attempts: 1,
    rowCount: result.rowCount,
    success: true,
    error: null,
    userEmail: ctx.userEmail,
    estCost: estimate?.cost ?? null,
    estRows: estimate?.rows ?? null,
  });
```

- [ ] **Step 4: Thread `conversationId` and handle `confirm` in the loop**

In `src/lib/integrations/ulink-agent/loop.ts`, add `conversationId` to `AgentInput` (after `userEmail`, line 17):

```typescript
export interface AgentInput {
  question: string;
  userEmail: string | null;
  conversationId?: string | null;
  history?: ConversationTurn[];
}
```

Set it on the context (in the `ctx` object, after `userEmail: input.userEmail,`, line 84):

```typescript
      userEmail: input.userEmail,
      conversationId: input.conversationId ?? null,
      maxRows,
```

Handle the confirm outcome right after the existing `clarify` block inside the tool loop (after lines 107-112, the `if (outcome.clarify)` block):

```typescript
          if (outcome.confirm) {
            emit({
              type: "confirm_required",
              token: outcome.confirm.token,
              estCost: outcome.confirm.estCost,
              estRows: outcome.confirm.estRows,
              sql: outcome.confirm.sql,
              question: outcome.confirm.question,
            });
            emit({ type: "phase", phase: "done" });
            emit({ type: "done", logId: null });
            return;
          }
```

- [ ] **Step 5: Pass `conversationId` in and skip persist on a confirm-only turn**

In `src/app/api/agent/query/route.ts`, add `conversationId` to the `runAgent` input (line 49):

```typescript
            { question, userEmail, conversationId, history },
```

Then guard persistence so a turn that ended in a confirm prompt is not saved (it will be saved by the confirm route once the user runs it). Replace the `if (persist) {` line (line 68) with:

```typescript
        const awaitingConfirm = collected.some((e) => e.type === "confirm_required");
        if (persist && !awaitingConfirm) {
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integrations/ulink-agent/events.ts src/lib/integrations/ulink-agent/agent-tools.ts src/lib/integrations/ulink-agent/loop.ts src/app/api/agent/query/route.ts
git commit -m "feat(agent): cost-gate wiring + confirm_required event"
```

---

## Task 5: result narration helper + confirm route

**Files:**
- Create: `src/lib/integrations/ulink-agent/narrate.ts`
- Create: `src/app/api/agent/confirm/route.ts`

- [ ] **Step 1: Write the narration helper**

Create `src/lib/integrations/ulink-agent/narrate.ts`:

```typescript
import type { LLMClient } from "./llm";
import type { QueryResult } from "./types";

// A single, tool-free LLM pass that summarizes a query result in prose. Used by
// the confirm route (which executes an already-approved query and needs a reply
// without re-running the full orchestration loop). Streams content deltas.
export async function narrateResult(
  llm: LLMClient,
  question: string,
  result: QueryResult,
  onDelta: (delta: string) => void
): Promise<string> {
  const preview = {
    columns: result.columns,
    rowCount: result.rowCount,
    rows: result.rows.slice(0, 50),
  };
  return llm.stream(
    [
      {
        role: "system",
        content:
          "You are the PM Data Agent for ULink. Summarize the result of a data query in 1-2 " +
          "concise sentences. The full result table is rendered to the user automatically below " +
          "your reply, so do NOT reproduce it as a list or markdown table — quote at most a key " +
          "figure or two and refer to the table. Only state numbers present in the result.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nResult (JSON, first 50 rows):\n${JSON.stringify(preview)}`,
      },
    ],
    { onContent: onDelta }
  );
}
```

- [ ] **Step 2: Write the confirm route**

Create `src/app/api/agent/confirm/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { getFastClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { conversationStore, persistTurn } from "@/lib/integrations/ulink-agent/conversations";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import { validateSelect } from "@/lib/integrations/ulink-agent/validate";
import { takePending } from "@/lib/integrations/ulink-agent/pending";
import { narrateResult } from "@/lib/integrations/ulink-agent/narrate";
import { getSessionEmail } from "@/lib/auth/session";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import type { QueryResult } from "@/lib/integrations/ulink-agent/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "token is required" }), { status: 400 });
  }

  const userEmail = await getSessionEmail(request);
  if (!userEmail) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const pending = await takePending(token, userEmail);
  if (!pending) {
    return new Response(
      JSON.stringify({ error: "This confirmation has expired. Please ask again." }),
      { status: 410 }
    );
  }

  // Re-validate the raw SQL before executing. The user has accepted the cost, so
  // we do not re-gate — read-only validation + the pm_readonly role + the
  // statement timeout remain the safety backstops.
  const v = validateSelect(pending.rawSql);
  if (!v.ok) {
    return new Response(JSON.stringify({ error: v.error ?? "Invalid SQL" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const collected: AgentEvent[] = [];
      const emit = (e: AgentEvent) => {
        collected.push(e);
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        emit({ type: "sql", sql: pending.rawSql });
        emit({ type: "phase", phase: "running" });

        let result: QueryResult;
        try {
          result = await executeReadOnly(v.sql);
        } catch (err) {
          const error = err instanceof Error ? err.message : "Query failed";
          await supabaseMemory.insertQueryLog({
            question: pending.question,
            sql: pending.rawSql,
            attempts: 1,
            rowCount: null,
            success: false,
            error,
            userEmail,
            estCost: pending.estCost,
            estRows: pending.estRows,
          });
          emit({ type: "error", error });
          emit({ type: "phase", phase: "error" });
          return;
        }

        emit({
          type: "result",
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          chart: pending.chart,
          display: pending.display,
        });

        const logId = await supabaseMemory.insertQueryLog({
          question: pending.question,
          sql: pending.rawSql,
          attempts: 1,
          rowCount: result.rowCount,
          success: true,
          error: null,
          userEmail,
          estCost: pending.estCost,
          estRows: pending.estRows,
        });

        try {
          await narrateResult(getFastClient(), pending.question, result, (delta) =>
            emit({ type: "narration", delta })
          );
        } catch {
          emit({ type: "narration", delta: "Here are the results." });
        }

        emit({ type: "phase", phase: "done" });
        emit({ type: "done", logId });

        try {
          const { conversationId: id, title } = await persistTurn(conversationStore, {
            question: pending.question,
            conversationId: pending.conversationId,
            userEmail,
            events: collected,
          });
          emit({ type: "conversation", conversationId: id, title });
        } catch (persistErr) {
          console.error("Persist confirmed turn failed:", persistErr);
        }
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

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

> If the build flags that `persistTurn` does not accept `conversationId: null`, pass `pending.conversationId ?? undefined` instead — match the existing call in `query/route.ts:72`, which passes the route's `conversationId` (typed `string | null`) directly; if that compiles, this will too.

- [ ] **Step 4: Commit**

```bash
git add src/lib/integrations/ulink-agent/narrate.ts src/app/api/agent/confirm/route.ts
git commit -m "feat(agent): confirm route executes approved query + narrates"
```

---

## Task 6: tighter statement timeout + pool sizing

**Files:**
- Modify: `src/lib/integrations/ulink-agent/client.ts:14-25`

- [ ] **Step 1: Make timeout and pool size env-driven**

In `src/lib/integrations/ulink-agent/client.ts`, replace the pool construction and the `connect` handler (lines 14-25) with:

```typescript
  const statementTimeoutMs = Number(process.env.ULINK_AGENT_STATEMENT_TIMEOUT_MS ?? 8000);
  const poolMax = Number(process.env.ULINK_AGENT_POOL_MAX ?? 4);

  pool = new Pool({
    connectionString,
    max: poolMax,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Enforce read-only + a hard statement timeout on every connection.
  pool.on("connect", (client) => {
    client
      .query(
        `SET default_transaction_read_only = on; SET statement_timeout = ${statementTimeoutMs};`
      )
      .catch((err) => console.error("Read-only pool SET failed:", err));
  });
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ulink-agent/client.ts
git commit -m "feat(agent): env-driven statement timeout + pool sizing"
```

---

## Task 7: per-user rate limit (TDD on parseWindow)

**Files:**
- Create: `src/lib/integrations/ulink-agent/ratelimit.ts`
- Test: `src/lib/integrations/ulink-agent/ratelimit.test.ts`
- Modify: `src/app/api/agent/query/route.ts:32-36`

- [ ] **Step 1: Write the failing test for `parseWindow`**

Create `src/lib/integrations/ulink-agent/ratelimit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseWindow } from "./ratelimit";

describe("parseWindow", () => {
  it("parses seconds, minutes, hours", () => {
    expect(parseWindow("60s")).toBe(60);
    expect(parseWindow("30m")).toBe(1800);
    expect(parseWindow("1h")).toBe(3600);
  });
  it("falls back to 3600 on garbage", () => {
    expect(parseWindow("")).toBe(3600);
    expect(parseWindow("nope")).toBe(3600);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/ratelimit.test.ts`
Expected: FAIL — cannot resolve `./ratelimit`.

- [ ] **Step 3: Write the rate limiter**

Create `src/lib/integrations/ulink-agent/ratelimit.ts`:

```typescript
import { getRedis } from "@/lib/cache/kv";

// "60s" | "30m" | "1h" → seconds. Defaults to 1 hour on anything unparseable.
export function parseWindow(spec: string): number {
  const m = /^(\d+)\s*([smh])$/.exec(spec.trim());
  if (!m) return 3600;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  return n * 3600;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
}

// Fixed-window counter keyed per user. Cheap (one INCR + conditional EXPIRE) and
// dependency-free on top of @upstash/redis. Fails open if Redis is unreachable.
export async function checkAgentRateLimit(email: string): Promise<RateLimitResult> {
  const limit = Number(process.env.ULINK_AGENT_RATE_LIMIT ?? 30);
  const windowSec = parseWindow(process.env.ULINK_AGENT_RATE_WINDOW ?? "1h");
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `agent:rl:${email}:${bucket}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    return { ok: true, remaining: limit, limit };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/integrations/ulink-agent/ratelimit.test.ts`
Expected: PASS.

- [ ] **Step 5: Enforce the limit in the query route**

In `src/app/api/agent/query/route.ts`, add the import (after the `getSessionEmail` import, line 7):

```typescript
import { checkAgentRateLimit } from "@/lib/integrations/ulink-agent/ratelimit";
```

Then, immediately after the unauthorized check (after lines 34-36, the `if (!userEmail)` block), add:

```typescript
  const rl = await checkAgentRateLimit(userEmail);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({
        error: `Rate limit reached (${rl.limit} queries per window). Try again later.`,
      }),
      { status: 429 }
    );
  }
```

- [ ] **Step 6: Verify it compiles and tests pass**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integrations/ulink-agent/ratelimit.ts src/lib/integrations/ulink-agent/ratelimit.test.ts src/app/api/agent/query/route.ts
git commit -m "feat(agent): per-user fixed-window rate limit"
```

---

## Task 8: client state — message.pending + hook confirm + 429 handling

**Files:**
- Modify: `src/lib/integrations/ulink-agent/message.ts:9-43` (type + empty), `:45-73` (applyEvent)
- Modify: `src/hooks/use-agent-stream.ts`

- [ ] **Step 1: Add `pending` to `AgentMessage` and `emptyMessage`**

In `src/lib/integrations/ulink-agent/message.ts`, add a field to the `AgentMessage` interface (after `feedback`, line 23):

```typescript
  feedback: "up" | "down" | null;
  pending: { token: string; estCost: number; estRows: number; sql: string } | null;
```

And in `emptyMessage` (after `feedback: null,`, line 41):

```typescript
    feedback: null,
    pending: null,
```

- [ ] **Step 2: Handle `confirm_required` in `applyEvent`**

In `src/lib/integrations/ulink-agent/message.ts`, add a case to the `applyEvent` switch (before `case "conversation":`, line 68):

```typescript
    case "confirm_required":
      return {
        ...m,
        pending: { token: e.token, estCost: e.estCost, estRows: e.estRows, sql: e.sql },
        loading: false,
        phase: "done",
      };
```

- [ ] **Step 3: Add a `confirm` action to the hook**

In `src/hooks/use-agent-stream.ts`, add this function inside `useAgentStream`, after `sendFeedback` (after line 141). It mirrors `ask`'s stream-reading but targets an existing message id and clears its `pending` first:

```typescript
  async function confirm(messageId: string, token: string) {
    if (busy) return;
    setBusy(true);
    cancelInFlight();
    const controller = new AbortController();
    abortRef.current = controller;
    const runToken = runRef.current;
    const isCurrent = () => runRef.current === runToken && !controller.signal.aborted;

    const update = (fn: (m: AgentMessage) => AgentMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId ? fn(m) : m)));

    // Clear the confirm card and show the running state on the same message.
    update((m) => ({ ...m, pending: null, loading: true, phase: "running", error: null }));

    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const msg =
          res.status === 410
            ? "This confirmation has expired. Please ask again."
            : "Could not run the confirmed query.";
        update((m) => ({ ...m, loading: false, phase: "error", error: msg }));
        return;
      }
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as AgentEvent;
          if (event.type === "conversation") {
            if (isCurrent()) {
              setConversationId(event.conversationId);
              onConversation?.({ id: event.conversationId, title: event.title });
            }
            return;
          }
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
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        update((m) => ({ ...m, loading: false, phase: "error", error: "Network error" }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }
```

- [ ] **Step 4: Surface a 429 from `ask` as an error message**

In `src/hooks/use-agent-stream.ts`, inside `ask`, just after `const res = await fetch("/api/agent/query", {...});` and before `if (!res.body)` (line 79), add:

```typescript
      if (!res.ok) {
        let msg = "Request failed.";
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* keep default */
        }
        update((m) => ({ ...m, loading: false, phase: "error", error: msg }));
        return;
      }
```

- [ ] **Step 5: Export `confirm` from the hook**

In `src/hooks/use-agent-stream.ts`, add `confirm` to the returned object (line 170):

```typescript
  return { messages, conversationId, busy, loadingThread, ask, sendFeedback, confirm, load, newChat };
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

> `hydrateMessage` (message.ts:75-83) spreads `emptyMessage` then the payload, so loaded conversations default `pending: null` automatically — no change needed there.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integrations/ulink-agent/message.ts src/hooks/use-agent-stream.ts
git commit -m "feat(agent): client state + confirm action for the cost-gate"
```

---

## Task 9: confirm card UI

**Files:**
- Modify: `src/components/agent/agent-message.tsx:22-28` (props), `:90-95` (insert card)
- Modify: `src/app/(dashboard)/agent/page.tsx:40-41` (pull `confirm`), `:119-121` (pass it down)

- [ ] **Step 1: Accept an `onConfirm` prop**

In `src/components/agent/agent-message.tsx`, update the component props (lines 22-28) to:

```typescript
export function AgentMessage({
  message,
  onFeedback,
  onConfirm,
}: {
  message: AgentMessageType;
  onFeedback: (messageId: string, logId: string, helpful: boolean) => void;
  onConfirm: (messageId: string, token: string) => void;
}) {
```

- [ ] **Step 2: Render the confirm card**

In `src/components/agent/agent-message.tsx`, immediately after the `{/* error */}` block (after line 95, before the `{/* narration */}` block), insert:

```tsx
      {/* cost-gate confirmation */}
      {message.pending && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="text-amber-200">
            This query looks expensive (≈{Math.round(message.pending.estRows).toLocaleString()} rows,
            planner cost ≈{Math.round(message.pending.estCost).toLocaleString()}). Run it anyway?
          </p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
            {message.pending.sql}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onConfirm(message.id, message.pending!.token)}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
            >
              Run anyway
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Wire `confirm` through the page**

In `src/app/(dashboard)/agent/page.tsx`, pull `confirm` from the hook (lines 40-41):

```typescript
  const { messages, conversationId, busy, loadingThread, ask, sendFeedback, confirm, load, newChat } =
    useAgentStream(onConversation);
```

And pass it to each `AgentMessage` (lines 119-121):

```tsx
                {messages.map((m) => (
                  <AgentMessage key={m.id} message={m} onFeedback={sendFeedback} onConfirm={confirm} />
                ))}
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint passes.

> If lint flags any other consumer of `<AgentMessage>` for a missing `onConfirm` prop, grep `rg "AgentMessage" src` and add `onConfirm={...}` there too. As of this plan the only consumer is `agent/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/agent-message.tsx src/app/(dashboard)/agent/page.tsx
git commit -m "feat(agent): cost-gate confirmation card UI"
```

---

## Task 10: docs — env vars + read-replica requirement

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document env vars in `.env.example`**

Append to `.env.example` (create it if absent):

```bash
# --- ULink PM Data Agent: performance guardrails ---
# ULINK_READONLY_DATABASE_URL MUST point at a READ REPLICA, not the primary, so
# agent query load can never contend with production traffic.
ULINK_READONLY_DATABASE_URL=

# Cost-gate. Ship with the gate OFF (shadow mode): cost/rows are logged to
# pm_agent.query_log but nothing is blocked. Turn on after calibrating thresholds
# from observed est_cost / est_rows percentiles.
ULINK_AGENT_GATE_ENABLED=false
ULINK_AGENT_MAX_PLAN_COST=
ULINK_AGENT_MAX_PLAN_ROWS=

# Read-only pool tuning.
ULINK_AGENT_STATEMENT_TIMEOUT_MS=8000
ULINK_AGENT_POOL_MAX=4

# Per-user rate limit (fixed window).
ULINK_AGENT_RATE_LIMIT=30
ULINK_AGENT_RATE_WINDOW=1h
```

- [ ] **Step 2: Document the rollout in `README.md`**

Add a section to `README.md` (under the existing setup/config docs):

```markdown
### ULink Agent performance guardrails

The PM Data Agent runs LLM-generated SQL read-only. To protect the database:

- **Read replica:** `ULINK_READONLY_DATABASE_URL` must point at a read replica, not
  the primary. Run `supabase/ulink_agent_perf_guardrails.sql` once to add the
  `query_log` cost columns and set `statement_timeout`/`work_mem` on `pm_readonly`.
- **Cost-gate (shadow first):** Deploy with `ULINK_AGENT_GATE_ENABLED=false`. Every
  query's planner estimate is logged to `pm_agent.query_log` (`est_cost`,
  `est_rows`). After a few days, set `ULINK_AGENT_MAX_PLAN_COST` /
  `ULINK_AGENT_MAX_PLAN_ROWS` from observed percentiles and set
  `ULINK_AGENT_GATE_ENABLED=true`. Over-budget queries then prompt the user to
  "Run anyway".
- **Rate limit:** `ULINK_AGENT_RATE_LIMIT` queries per `ULINK_AGENT_RATE_WINDOW`
  per user.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs(agent): performance guardrails env vars + replica requirement"
```

---

## Task 11: end-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test + build gate**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all tests pass; build and lint succeed.

- [ ] **Step 2: Shadow-mode smoke (gate off)**

With `ULINK_AGENT_GATE_ENABLED=false`, run `npm run dev`, open the agent, ask a normal question (e.g. "How many signups per week over the last 8 weeks?").
Expected: answers normally; a row appears in `pm_agent.query_log` with non-null `est_cost`/`est_rows`; no confirm card.

- [ ] **Step 3: Gate-on confirmation flow**

Set `ULINK_AGENT_GATE_ENABLED=true` and `ULINK_AGENT_MAX_PLAN_COST=1` (force a trip), restart dev, ask any question.
Expected: a confirm card appears showing estimated rows/cost + the SQL. Clicking "Run anyway" runs the query, renders the table/chart, and shows a narration line. The turn appears in the conversation sidebar after running.

- [ ] **Step 4: Expired-token path**

Trigger a confirm card, wait >5 minutes (or delete the `agent:pending:*` key in Redis), then click "Run anyway".
Expected: an inline error "This confirmation has expired. Please ask again." (HTTP 410), no crash.

- [ ] **Step 5: Rate limit**

Set `ULINK_AGENT_RATE_LIMIT=2`, restart, ask 3 questions quickly.
Expected: the 3rd shows the rate-limit error (HTTP 429).

- [ ] **Step 6: Reset env to ship defaults**

Confirm `.env` ends with `ULINK_AGENT_GATE_ENABLED=false` and sane thresholds for the shadow-mode rollout, then proceed to merge.

---

## Self-Review

- **Spec coverage:** EXPLAIN gate (Tasks 2, 4) ✓; warn+confirm via Redis stash + confirm route (Tasks 3, 5, 8, 9) ✓; shadow mode + `query_log` cost columns (Tasks 1, 2, 4) ✓; statement timeout / pool / DB-role limits (Tasks 1, 6) ✓; read-replica documentation (Task 10) ✓; rate limiting (Task 7) ✓; verification (Task 11) ✓.
- **Type consistency:** `CostEstimate`/`Budget` (explain.ts) used in agent-tools.ts; `PendingQuery` (pending.ts) shape matches the stash in agent-tools.ts and the read in confirm/route.ts; `confirm_required` event fields match `ToolOutcome.confirm`, the loop emit, and `applyEvent`; `AgentMessage.pending` matches the event and the UI card; `checkAgentRateLimit`/`parseWindow` names consistent across ratelimit.ts, its test, and the route.
- **Deviation from spec (noted):** the confirm route re-validates but does NOT re-run EXPLAIN — the user has already accepted the cost, so a second estimate would not change the decision; read-only validation + the `pm_readonly` role + `statement_timeout` remain the real backstops. This is a deliberate simplification of the spec's "re-validate + re-EXPLAIN".
- **Placeholder scan:** no TBD/TODO; threshold env values are intentionally blank (shadow-mode calibration), which is the designed rollout, not an unfinished step.
```
