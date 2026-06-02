# Chat Persistence for the PM Data Agent — Design

**Date:** 2026-06-02
**Status:** Approved (design); pending implementation plan
**Project:** `flywheel_saas_dashboard` (Flywheel Command Center) — PM Data Agent

## Problem

Today the PM Data Agent's chat lives entirely in client `useState` (`useAgentStream`).
A page refresh loses everything. Users need to: keep chats across sessions, reopen an
old chat, start a new chat, and remove a chat.

## Decisions (locked during brainstorming)

- **Scope:** Shared workspace. All signed-in dashboard users see one pool of chats and
  may open or delete any of them. The creator's email is shown subtly per chat.
- **Fidelity:** Full. Each assistant turn persists narration, the R1 reasoning stream,
  the step log, SQL, chart spec, and the result table — so a reopened chat looks
  identical to a live one (including the "Thinking" panel).
- **Persistence model:** Server-side, one JSONB row per turn (Approach A).
- **Storage home:** ULink production DB, `pm_agent` schema, via the existing
  service-role REST client (`getULinkClient().schema("pm_agent")`) — same pattern as
  `memory.ts`. There is no dashboard-owned Postgres.
- **Delete semantics:** Hard delete with `on delete cascade` (no soft-delete/archive).
- **Title:** Auto-derived from the first question (no manual rename — YAGNI).

## Architecture

A "message" row is one **turn**: the user's `question` plus the entire assistant
response captured as a single JSONB `payload`. The streaming query route already emits
every `AgentEvent`; we wrap `emit` to also collect events, reduce them into the canonical
`AgentMessage` shape after the turn finishes, and persist that. Conversations are created
implicitly on the first turn. Listing/loading/deleting are separate REST endpoints.

### 1. Data model (`pm_agent` schema, ULink DB)

```sql
create table pm_agent.conversations (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table pm_agent.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references pm_agent.conversations(id) on delete cascade,
  question        text not null,
  payload         jsonb not null,
  user_email      text,
  created_at      timestamptz not null default now()
);
create index messages_conversation_created_idx
  on pm_agent.messages (conversation_id, created_at);

alter table pm_agent.conversations enable row level security;
alter table pm_agent.messages      enable row level security;
-- No policies: the service-role client bypasses RLS; this hard-blocks any access
-- through the exposed PostgREST API (anon/authenticated roles).
```

- `payload` JSONB holds the full assistant turn: `narration`, `reasoning`, `steps`,
  `sql`, `chart`, `result`, `error`, `logId`, `phase`. JSONB means no schema churn when
  `AgentMessage` evolves.
- `updated_at` on `conversations` is bumped on each new turn; the sidebar sorts by it.
- `on delete cascade`: deleting a conversation removes its messages in one statement.

This migration is provisioned directly against the ULink prod DB (it lives in `pm_agent`,
which is owned/maintained from this dashboard project, not in ULink's own migrations).
The SQL is also saved to `supabase/pm_agent_conversations.sql` for the record.

### 2. Shared reducer extraction

Move the message types and reducer out of the client hook into a pure module so both the
client and the server can use them:

- **New** `src/lib/integrations/ulink-agent/message.ts` (no `"use client"`):
  `AgentStep`, `AgentMessage`, `emptyMessage(id, question)`, `applyEvent(m, e)`.
- `src/hooks/use-agent-stream.ts` imports these instead of defining them.

The server reduces the events it emitted (starting from `emptyMessage`) into the exact
same `AgentMessage`, guaranteeing the persisted payload matches what the client renders.

### 3. Persistence (server-side, in the query route)

In `src/app/api/agent/query/route.ts`:

- Read optional `conversationId: string` from the request body (alongside `question`,
  `history`).
- Wrap the emitter to also collect events:
  ```ts
  const collected: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    collected.push(e);
    controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
  };
  ```
- After `runAgent` resolves, reduce `collected` into an `AgentMessage` payload:
  ```ts
  const payload = collected.reduce(applyEvent, emptyMessage("persist", question));
  ```
- Persist (best-effort — see Error handling):
  - If no `conversationId`: `conversationStore.createConversation({ title: deriveTitle(question), userEmail })` → new id.
  - `conversationStore.appendMessage({ conversationId, question, payload, userEmail })`
    (also bumps `updated_at`).
  - Emit `{ type: "conversation", conversationId, title }` **before** the stream closes
    so the client learns the id (and the title for a brand-new chat).

`deriveTitle(question)`: trimmed first line, truncated to ~60 chars with an ellipsis if
longer; falls back to `"New chat"` if empty.

### 4. Conversation store

**New** `src/lib/integrations/ulink-agent/conversations.ts` exporting `conversationStore`,
using the same `getULinkClient().schema("pm_agent")` pattern as `memory.ts`:

- `createConversation({ title, userEmail }): Promise<{ id: string }>`
- `appendMessage({ conversationId, question, payload, userEmail }): Promise<void>`
  — inserts a message row and updates the parent's `updated_at`.
- `listConversations(): Promise<ConversationSummary[]>`
  — `{ id, title, createdByEmail, updatedAt }`, ordered by `updated_at desc`, limit 100.
- `getConversation(id): Promise<{ conversation: ConversationSummary; messages: AgentMessage[] }>`
  — messages ordered by `created_at asc`; each `payload` rehydrated to `AgentMessage`.
- `deleteConversation(id): Promise<void>` — cascade delete.

Types added to `types.ts`:
```ts
export interface ConversationSummary {
  id: string;
  title: string;
  createdByEmail: string | null;
  updatedAt: string;
}
```

### 5. API endpoints

All require a valid Firebase session via the existing `getUserEmail`; return `401` when
absent. Shared pool, so listing is **not** filtered by email.

- `POST /api/agent/query` — **modified** as in §3.
- `GET /api/agent/conversations` — `{ conversations: ConversationSummary[] }`.
- `GET /api/agent/conversations/[id]` — `{ conversation, messages }`; `404` if missing.
- `DELETE /api/agent/conversations/[id]` — `{ ok: true }`; idempotent.

### 6. New `AgentEvent` variant

Add to `events.ts`:
```ts
| { type: "conversation"; conversationId: string; title: string }
```
`applyEvent` handles it by setting nothing on the per-turn `AgentMessage` (it's a
conversation-level signal); the **hook** intercepts it to set `conversationId` and refresh
the list. `applyEvent` returns the message unchanged for this event type.

### 7. Client / UI

`/agent` page becomes two-column:

- **Left sidebar (~260px, bordered):**
  - "＋ New chat" button at top → clears `messages`, sets `conversationId = null`.
  - Conversation list: title, relative `updatedAt` (date-fns `formatDistanceToNow`),
    faint creator email. Active row highlighted. Trash icon appears on row hover →
    delete.
  - Empty state when no chats yet.
- **Right:** existing chat stream + composer, unchanged.

Hooks:

- **New** `src/hooks/use-conversation-list.ts` → `useConversationList()`: fetches the list
  on mount, exposes `conversations`, `refresh()`, `remove(id)` (optimistic removal + DELETE).
- `useAgentStream` **extended**:
  - tracks `conversationId: string | null`.
  - `ask(question)` includes `conversationId` in the POST body.
  - on a `conversation` event: set `conversationId`; caller refreshes the list.
  - `load(id)`: GET the conversation, hydrate `messages` from `payload` (each
    `loading: false`), set `conversationId`.
  - `newChat()`: clear `messages`, `conversationId = null`.

The page wires them: a `conversation` event (surfaced from the hook) triggers
`list.refresh()`. Deleting the active conversation calls `newChat()`.

Reopened turns render through the existing `AgentMessage` component; 👍/👎 feedback still
works because the `logId` is inside the saved payload.

## Error handling

- **Persistence failures never break the answer.** The create/append/emit block is wrapped
  in try/catch; on failure it `console.error`s server-side and the stream still completes
  with `done`. The turn simply isn't saved.
- **List/get/delete:** standard JSON error responses; `401` without a session, `404` for a
  missing conversation on GET, `500` on store errors.
- **Delete of the active chat:** client resets to a new chat.
- **Malformed `conversationId`:** if `appendMessage` targets a non-existent conversation
  (e.g. it was deleted mid-stream), the insert fails the FK and is swallowed by the
  best-effort guard; the user still sees the answer.

## Testing (Vitest, matching existing patterns)

- `deriveTitle`: truncation, trimming, empty fallback.
- `applyEvent` (moved): existing cases still pass + the new `conversation` event is a no-op
  on the message.
- Server reduction: a representative event sequence reduces to the expected `AgentMessage`
  payload.
- `conversationStore`: `createConversation`, `appendMessage` (inserts + bumps
  `updated_at`), `listConversations` (ordering/limit), `getConversation` (rehydration +
  ordering), `deleteConversation` — against a mocked supabase client.
- Route: creates a conversation on the first turn (no id in → `conversation` event out with
  a new id), appends on later turns (id in → same id out); a thrown persistence error is
  swallowed and `done` is still emitted.

## Out of scope (YAGNI)

- Manual rename of chats.
- Soft delete / archive / trash recovery.
- Pagination / search of the conversation list (limit 100, newest first).
- Per-user privacy or sharing controls (workspace is fully shared by decision).
- Editing or branching past turns.

## Files

- **New:** `src/lib/integrations/ulink-agent/message.ts`
- **New:** `src/lib/integrations/ulink-agent/conversations.ts`
- **New:** `src/hooks/use-conversation-list.ts`
- **New:** `src/app/api/agent/conversations/route.ts` (GET list)
- **New:** `src/app/api/agent/conversations/[id]/route.ts` (GET one, DELETE)
- **New:** `supabase/pm_agent_conversations.sql`
- **Modify:** `src/lib/integrations/ulink-agent/events.ts` (add `conversation` event)
- **Modify:** `src/lib/integrations/ulink-agent/types.ts` (add `ConversationSummary`)
- **Modify:** `src/app/api/agent/query/route.ts` (collect events, persist, emit event)
- **Modify:** `src/hooks/use-agent-stream.ts` (import reducer; conversation state, `load`, `newChat`)
- **Modify:** `src/app/(dashboard)/agent/page.tsx` (two-column layout + sidebar)
