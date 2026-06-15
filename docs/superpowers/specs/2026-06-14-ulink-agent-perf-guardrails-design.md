# ULink Agent — Performance Guardrails

**Date:** 2026-06-14
**Status:** Approved design, pending implementation plan
**Area:** `src/lib/integrations/ulink-agent/`, `src/app/api/agent/`, `src/hooks/use-agent-stream.ts`, `supabase/`

## Background

The ULink PM Data Agent turns natural-language questions into SQL (DeepSeek R1),
validates it, runs it read-only, and renders a Tremor table/chart. The agent runs
autonomously inside a single streaming request (`loop.ts` → `agent-tools.ts:runQuery`
→ `executeReadOnly`).

The concern being addressed: an LLM writing SQL has no knowledge of indexes, data
volumes, or query plans, so it can generate logically-correct queries that do
near-cartesian joins or large sequential scans. The current guardrails do **not**
fully cover this:

- The `LIMIT 1000` wrap in `validate.ts` bounds *result size*, not *work done* — a
  heavy join/aggregation is fully computed before the outer `LIMIT` applies.
- `statement_timeout = 15000` is the only real cap on runaway work; 15s of heavy
  scan on a busy primary still contends with production traffic.

Human-in-the-loop *approval of SQL text* was considered and rejected as the primary
control: humans cannot reliably predict query cost by reading SQL, and a per-query
approval gate would gut the tool's self-serve value. Instead, performance is
guarded with technical controls, and human confirmation is reserved for the rare
query a cost estimator flags as expensive.

## Goals

1. Prevent the agent from silently running expensive queries against the ULink DB.
2. Keep the fast, self-serve UX for normal (cheap) queries — no friction.
3. Bound per-query resource use at the database, not just in app code.
4. Cap per-user query volume to limit both DB load and LLM cost.

## Non-Goals

- Guaranteeing result *correctness* (right joins/filters/timezones). That is a
  separate trust concern, partly addressed elsewhere by surfacing the SQL.
- Rewriting the validator's regex blocklist. The read-only role remains the real
  data-safety backstop; the regex is belt-and-suspenders and is unchanged here.
- Changing the LLM provider/model.

## Design

### 1. EXPLAIN cost-gate

New module `src/lib/integrations/ulink-agent/explain.ts`:

```
estimateCost(execute, wrappedSql) → { cost: number, rows: number }
```

- Runs `EXPLAIN (FORMAT JSON) <wrappedSql>` through the existing read-only pool.
  `EXPLAIN` without `ANALYZE` only plans — it never executes the query. Cost is a
  few milliseconds.
- Parses the top plan node's `Total Cost` and `Plan Rows`.
- Gate trips when **either** `cost > ULINK_AGENT_MAX_PLAN_COST` **or**
  `rows > ULINK_AGENT_MAX_PLAN_ROWS` (both env-configured).

Wiring: in `agent-tools.ts:runQuery`, between `validateSelect` (~line 113) and
`execute` (~line 132):

1. `validateSelect` → wrapped SQL (as today).
2. `estimateCost(ctx.execute, v.sql)`.
3. Under budget → `execute` and emit `result` as today.
4. Over budget → stash query (§2) + emit `confirm_required`, return without executing.

**EXPLAIN estimates are heuristic.** Postgres cost is in arbitrary units and
estimates can be wrong on stale statistics, so the gate is a filter, not a
guarantee — `statement_timeout` remains the true backstop.

**Shadow mode first.** Because thresholds are guesswork until calibrated:

- Phase 1: compute and log `cost`/`rows` for every query (extend `query_log`), but
  do **not** block. Run for a few days.
- Phase 2: set `ULINK_AGENT_MAX_PLAN_COST` / `ULINK_AGENT_MAX_PLAN_ROWS` from
  observed percentiles, then enable blocking.

A flag `ULINK_AGENT_GATE_ENABLED` (default `false`) controls whether the gate
blocks or only logs.

### 2. Confirmation flow (warn + confirm)

Server-side, stateless, fitting the existing streaming model.

- New event `confirm_required` in `events.ts`:
  `{ type: "confirm_required", token, cost, rows, sql, question }`.
- On a gated query, stash in Upstash Redis:
  - key `agent:pending:{token}` (random token), TTL 5 minutes
  - value `{ sql, question, chartHint, display, userEmail, conversationId }`
  - lookup is **scoped to the session email** — a user cannot confirm another
    user's pending query.
- Emit `confirm_required` and end the stream.
- New route `POST /api/agent/confirm`:
  1. Verify session (`getSessionEmail`).
  2. Load token from Redis; assert stored `userEmail` matches the session email.
  3. Re-validate (`validateSelect`) and re-run `estimateCost` — defends against a
     stale/replayed token and confirms the SQL is still read-only and unchanged.
  4. `execute` the stored SQL.
  5. Stream a `result` event + a single lightweight narration pass over the result.
  6. Persist the turn (same path as a normal turn).

**Accepted limitation:** the confirmed path narrates a single result rather than
resuming the full multi-step orchestration loop. For this tool most turns are one
query → narrate, so this is acceptable; a rare multi-step turn loses orchestration
after the confirmed step.

Client (`use-agent-stream.ts` + agent message UI):

- On `confirm_required`, render a confirm card: "This query is estimated to be
  expensive (~X rows / cost). [Show SQL] [Run anyway] [Cancel]".
- "Run anyway" → `POST /api/agent/confirm` with the token, then stream the result.
- "Cancel" → discard; no execution.

### 3. Timeouts / pool / replica config

`client.ts`:

- Lower `statement_timeout` 15s → **8s default**, env `ULINK_AGENT_STATEMENT_TIMEOUT_MS`.
- Keep `max: 4`; make it env-tunable. Add `idleTimeoutMillis` and
  `connectionTimeoutMillis`.

Database-level (belt-and-suspenders), new SQL script in `supabase/`:

```sql
ALTER ROLE pm_readonly SET statement_timeout = '8s';
ALTER ROLE pm_readonly SET work_mem = '<cap>';
```

So the limit holds even if app code regresses.

Read replica (config/ops, not code):

- Verify what `ULINK_READONLY_DATABASE_URL` currently points at.
- If a read replica exists, point the var at it.
- Document in `.env.example` + README that this URL **must** be a read replica, so
  agent load never touches production traffic.

### 4. Rate / cost limiting

- Per-user sliding window on `POST /api/agent/query` via `@upstash/ratelimit`
  (built on the existing `@upstash/redis`).
- Default **30 queries/hour**, env-configured (`ULINK_AGENT_RATE_LIMIT`,
  `ULINK_AGENT_RATE_WINDOW`).
- Over limit → `429` with a friendly message surfaced in the UI.
- `/api/agent/confirm` counts toward the same window but does not regenerate SQL.

## Configuration summary

| Env var | Default | Purpose |
|---|---|---|
| `ULINK_AGENT_GATE_ENABLED` | `false` | Block on gate vs. shadow-log only |
| `ULINK_AGENT_MAX_PLAN_COST` | TBD (calibrate) | EXPLAIN total-cost threshold |
| `ULINK_AGENT_MAX_PLAN_ROWS` | TBD (calibrate) | EXPLAIN plan-rows threshold |
| `ULINK_AGENT_STATEMENT_TIMEOUT_MS` | `8000` | Per-connection statement timeout |
| `ULINK_AGENT_POOL_MAX` | `4` | Read-only pool size |
| `ULINK_AGENT_RATE_LIMIT` | `30` | Queries per window per user |
| `ULINK_AGENT_RATE_WINDOW` | `1h` | Rate-limit window |

(`MAX_PLAN_*` defaults stay effectively disabled until shadow-mode calibration; the
gate ships off via `ULINK_AGENT_GATE_ENABLED=false`.)

## Verification

No test framework is configured. Verification:

- A standalone script feeds known-cheap and deliberately-heavy queries through
  `estimateCost` and asserts the gate trips correctly at configured thresholds.
- Manual dev click-through: trigger a gated query, see the confirm card, "Run
  anyway" executes; "Cancel" does nothing; rate limit returns 429 in the UI.
- Confirm shadow-mode logging records cost/rows without blocking when
  `ULINK_AGENT_GATE_ENABLED=false`.

## Files touched (anticipated)

- `src/lib/integrations/ulink-agent/explain.ts` — new
- `src/lib/integrations/ulink-agent/client.ts` — timeout/pool env
- `src/lib/integrations/ulink-agent/agent-tools.ts` — gate wiring, stash on gate
- `src/lib/integrations/ulink-agent/events.ts` — `confirm_required` event
- `src/lib/integrations/ulink-agent/memory.ts` — `query_log` cost/rows columns
- `src/app/api/agent/query/route.ts` — rate limit
- `src/app/api/agent/confirm/route.ts` — new
- `src/hooks/use-agent-stream.ts` — handle `confirm_required`, call confirm
- `src/components/agent/*` — confirm card UI
- `supabase/` — `pm_readonly` role limits + `query_log` columns
- `.env.example`, `README` — replica requirement + new env vars
```
