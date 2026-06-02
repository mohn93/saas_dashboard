# Chat Persistence for the PM Data Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the PM Data Agent's chats so users can create a new chat, reopen old ones, and delete them — as a shared workspace, full-fidelity, stored in ULink's `pm_agent` schema.

**Architecture:** One JSONB row per turn (`question` + the whole assistant `AgentMessage` payload) in new `pm_agent.conversations` / `pm_agent.messages` tables. The streaming query route collects the events it emits, reduces them into the canonical `AgentMessage` via a shared reducer, and persists server-side; it emits a new `conversation` event so the client learns the id. Separate REST endpoints list/load/delete. The `/agent` page gains a left sidebar.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest, `@supabase/supabase-js` (service-role REST, `.schema("pm_agent")`), Tailwind, lucide-react, date-fns.

**Spec:** `docs/superpowers/specs/2026-06-02-chat-persistence-design.md`

---

## File Structure

- **New** `supabase/pm_agent_conversations.sql` — migration SQL (record of what was provisioned).
- **New** `src/lib/integrations/ulink-agent/message.ts` — pure message types + reducer (`AgentMessage`, `AgentStep`, `emptyMessage`, `applyEvent`, `hydrateMessage`). Moved out of the client hook so the server can use it.
- **New** `src/lib/integrations/ulink-agent/conversations.ts` — `ConversationStore` interface, `conversationStore` (supabase impl), `deriveTitle`, `persistTurn`.
- **New** `src/lib/auth/session.ts` — `getSessionEmail(request)` shared session helper.
- **New** `src/hooks/use-conversation-list.ts` — `useConversationList()`.
- **New** `src/components/agent/conversation-sidebar.tsx` — sidebar UI.
- **New** `src/app/api/agent/conversations/route.ts` — `GET` list.
- **New** `src/app/api/agent/conversations/[id]/route.ts` — `GET` one, `DELETE`.
- **Modify** `src/lib/integrations/ulink-agent/events.ts` — add `conversation` event.
- **Modify** `src/lib/integrations/ulink-agent/types.ts` — add `ConversationSummary`.
- **Modify** `src/hooks/use-agent-stream.ts` — re-export reducer from `message.ts`; add conversation state, `load`, `newChat`, send `conversationId`, surface `conversation` events.
- **Modify** `src/app/api/agent/query/route.ts` — collect events, persist via `persistTurn`, emit `conversation` event, accept `conversationId`; use `getSessionEmail`.
- **Modify** `src/app/(dashboard)/agent/page.tsx` — two-column layout + sidebar wiring.

**Testing note (matches this repo's convention):** Pure logic is unit-tested (`deriveTitle`, `applyEvent`, `hydrateMessage`, `persistTurn` against an in-memory fake store). The thin supabase glue in `conversationStore` mirrors the existing untested `memory.ts` exactly and is verified by `npm run build` + manual smoke test, not by brittle query-chain mocks. Route handlers and React hooks (streaming/fetch wiring) are likewise verified by build + manual test, consistent with the existing untested `query`/`feedback` routes.

**Run before finishing any task:** `npm test` (Vitest), `npm run lint`, `npm run build`.

---

### Task 1: Provision the database tables

**Files:**
- Create: `supabase/pm_agent_conversations.sql`

- [ ] **Step 1: Write the migration SQL file**

Create `supabase/pm_agent_conversations.sql`:

```sql
-- Chat persistence for the PM Data Agent (shared workspace, full-fidelity).
-- Lives in the pm_agent schema in ULink's prod DB (project ref cjgihassfsspxivjtgoi).

create table if not exists pm_agent.conversations (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists pm_agent.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references pm_agent.conversations(id) on delete cascade,
  question        text not null,
  payload         jsonb not null,
  user_email      text,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on pm_agent.messages (conversation_id, created_at);

-- No policies: the dashboard uses the service-role client (bypasses RLS).
-- Enabling RLS hard-blocks any access through the exposed PostgREST API.
alter table pm_agent.conversations enable row level security;
alter table pm_agent.messages      enable row level security;

-- PostgREST must reload to expose the new tables (the pm_agent schema is already exposed).
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it against ULink prod**

Run the SQL against project `cjgihassfsspxivjtgoi` using the Supabase MCP `apply_migration`
(name: `pm_agent_conversations`) or the SQL editor. The `pm_agent` schema already exists and
is already exposed to PostgREST (see the project memory), so only the `notify pgrst` reload is
needed for the new tables.

- [ ] **Step 3: Verify the tables exist and are reachable**

Run (MCP `execute_sql` or SQL editor):

```sql
select count(*) from pm_agent.conversations;
select count(*) from pm_agent.messages;
```

Expected: both return `0` (tables exist, empty).

- [ ] **Step 4: Commit**

```bash
git add supabase/pm_agent_conversations.sql
git commit -m "feat(agent): pm_agent conversations + messages tables"
```

---

### Task 2: Extract the message reducer to a shared module

Moves `AgentMessage`, `AgentStep`, `emptyMessage`, `applyEvent` out of the client hook into a
pure module so the server can reuse them. The hook re-exports them so the existing test
(`use-agent-stream.test.ts`, which imports from `./use-agent-stream`) stays green.

**Files:**
- Create: `src/lib/integrations/ulink-agent/message.ts`
- Modify: `src/hooks/use-agent-stream.ts`
- Test: `src/lib/integrations/ulink-agent/message.test.ts`

- [ ] **Step 1: Create `message.ts` with the moved code (verbatim from the hook)**

```ts
import type { AgentEvent, AgentPhase } from "./events";
import type { ChartSpec, QueryResult } from "./types";

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
```

- [ ] **Step 2: Rewrite the top of `use-agent-stream.ts` to import + re-export**

Replace the type/`emptyMessage`/`applyEvent` definitions (lines ~3-75) with imports and
re-exports. The new top of the file:

```ts
"use client";

import { useState } from "react";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";
import {
  applyEvent,
  emptyMessage,
  type AgentMessage,
  type AgentStep,
} from "@/lib/integrations/ulink-agent/message";

export { applyEvent, emptyMessage };
export type { AgentMessage, AgentStep };
```

Leave the rest of the file (the `useAgentStream` hook body, `nextId`, etc.) unchanged for now.

- [ ] **Step 3: Run the existing test to confirm nothing broke**

Run: `npx vitest run src/hooks/use-agent-stream.test.ts src/lib/integrations/ulink-agent/loop.test.ts`
Expected: PASS (the existing `applyEvent`/`emptyMessage` test resolves via the re-export).

- [ ] **Step 4: Add `message.test.ts` mirroring the moved cases**

```ts
import { describe, expect, it } from "vitest";
import { applyEvent, emptyMessage } from "./message";

describe("applyEvent (message reducer)", () => {
  it("accumulates reasoning, steps, narration and finalizes on done", () => {
    let m = emptyMessage("m1", "how many links");
    m = applyEvent(m, { type: "reasoning", delta: "think " });
    m = applyEvent(m, { type: "reasoning", delta: "more" });
    m = applyEvent(m, { type: "step", label: "Selected tables", detail: "links" });
    m = applyEvent(m, { type: "sql", sql: "SELECT 1" });
    m = applyEvent(m, {
      type: "result",
      columns: ["n"],
      rows: [{ n: 5 }],
      rowCount: 1,
      chart: { type: "none", xColumn: null, yColumn: null },
    });
    m = applyEvent(m, { type: "narration", delta: "You have 5 links." });
    m = applyEvent(m, { type: "done", logId: "log-1" });

    expect(m.reasoning).toBe("think more");
    expect(m.steps).toHaveLength(1);
    expect(m.sql).toBe("SELECT 1");
    expect(m.result?.rowCount).toBe(1);
    expect(m.narration).toBe("You have 5 links.");
    expect(m.logId).toBe("log-1");
    expect(m.loading).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/integrations/ulink-agent/message.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/ulink-agent/message.ts src/lib/integrations/ulink-agent/message.test.ts src/hooks/use-agent-stream.ts
git commit -m "refactor(agent): extract message reducer into shared module"
```

---

### Task 3: Add the `conversation` event, `ConversationSummary` type, and `hydrateMessage`

**Files:**
- Modify: `src/lib/integrations/ulink-agent/events.ts`
- Modify: `src/lib/integrations/ulink-agent/types.ts`
- Modify: `src/lib/integrations/ulink-agent/message.ts`
- Test: `src/lib/integrations/ulink-agent/message.test.ts`

- [ ] **Step 1: Write failing tests for the no-op event and `hydrateMessage`**

Append to `src/lib/integrations/ulink-agent/message.test.ts`:

```ts
import { hydrateMessage } from "./message";

describe("conversation event", () => {
  it("is a no-op on the message", () => {
    const before = emptyMessage("m1", "q");
    const after = applyEvent(before, {
      type: "conversation",
      conversationId: "c1",
      title: "q",
    });
    expect(after).toEqual(before);
  });
});

describe("hydrateMessage", () => {
  it("rebuilds a finished AgentMessage from a stored payload", () => {
    const payload = {
      ...emptyMessage("", "how many links"),
      narration: "You have 5 links.",
      sql: "SELECT 1",
      logId: "log-1",
      loading: true, // stored value should be overridden
    };
    const m = hydrateMessage("row-1", "how many links", payload);
    expect(m.id).toBe("row-1");
    expect(m.question).toBe("how many links");
    expect(m.narration).toBe("You have 5 links.");
    expect(m.loading).toBe(false);
  });

  it("tolerates a partial/missing payload by falling back to defaults", () => {
    const m = hydrateMessage("row-2", "q", {});
    expect(m.id).toBe("row-2");
    expect(m.narration).toBe("");
    expect(m.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/message.test.ts`
Expected: FAIL — `conversation` not assignable to `AgentEvent`; `hydrateMessage` is not exported.

- [ ] **Step 3: Add the `conversation` event to `events.ts`**

Add this member to the `AgentEvent` union (after the `error` member):

```ts
  | { type: "error"; error: string }
  | { type: "conversation"; conversationId: string; title: string };
```

- [ ] **Step 4: Add the explicit no-op case + `hydrateMessage` to `message.ts`**

In `applyEvent`, add an explicit case before `default` (documents intent):

```ts
    case "conversation":
      return m; // conversation-level signal; handled by the hook, not the message
```

At the end of `message.ts`, add:

```ts
export function hydrateMessage(
  id: string,
  question: string,
  payload: unknown
): AgentMessage {
  const base = emptyMessage(id, question);
  const p = (payload ?? {}) as Partial<AgentMessage>;
  return { ...base, ...p, id, question, loading: false };
}
```

- [ ] **Step 5: Add `ConversationSummary` to `types.ts`**

Append:

```ts
export interface ConversationSummary {
  id: string;
  title: string;
  createdByEmail: string | null;
  updatedAt: string;
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/integrations/ulink-agent/message.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integrations/ulink-agent/events.ts src/lib/integrations/ulink-agent/types.ts src/lib/integrations/ulink-agent/message.ts src/lib/integrations/ulink-agent/message.test.ts
git commit -m "feat(agent): conversation event, ConversationSummary, hydrateMessage"
```

---

### Task 4: Conversation store + `deriveTitle`

The `conversationStore` supabase impl mirrors `memory.ts` (untested glue). `deriveTitle` is
pure and unit-tested.

**Files:**
- Create: `src/lib/integrations/ulink-agent/conversations.ts`
- Test: `src/lib/integrations/ulink-agent/conversations.test.ts`

- [ ] **Step 1: Write the failing `deriveTitle` test**

Create `src/lib/integrations/ulink-agent/conversations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveTitle } from "./conversations";

describe("deriveTitle", () => {
  it("uses the trimmed first line", () => {
    expect(deriveTitle("  How many signups this week?  ")).toBe(
      "How many signups this week?"
    );
  });
  it("takes only the first line", () => {
    expect(deriveTitle("revenue by month\nand also churn")).toBe("revenue by month");
  });
  it("truncates long questions with an ellipsis", () => {
    const long = "a".repeat(80);
    const out = deriveTitle(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
  });
  it("falls back to 'New chat' when empty", () => {
    expect(deriveTitle("   ")).toBe("New chat");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/conversations.test.ts`
Expected: FAIL — cannot find module `./conversations`.

- [ ] **Step 3: Create `conversations.ts`**

```ts
import { getULinkClient } from "@/lib/integrations/ulink/client";
import type { AgentMessage } from "./message";
import { hydrateMessage } from "./message";
import type { ConversationSummary } from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

export function deriveTitle(question: string): string {
  const firstLine = question.trim().split("\n")[0].trim();
  if (!firstLine) return "New chat";
  return firstLine.length > 60 ? firstLine.slice(0, 59).trimEnd() + "…" : firstLine;
}

export interface ConversationStore {
  createConversation(input: {
    title: string;
    userEmail: string | null;
  }): Promise<{ id: string }>;
  appendMessage(input: {
    conversationId: string;
    question: string;
    payload: AgentMessage;
    userEmail: string | null;
  }): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(
    id: string
  ): Promise<{ conversation: ConversationSummary; messages: AgentMessage[] }>;
  deleteConversation(id: string): Promise<void>;
}

function toSummary(r: Record<string, unknown>): ConversationSummary {
  return {
    id: r.id as string,
    title: r.title as string,
    createdByEmail: (r.created_by_email as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export const conversationStore: ConversationStore = {
  async createConversation({ title, userEmail }) {
    const { data, error } = await db()
      .from("conversations")
      .insert({ title, created_by_email: userEmail })
      .select("id")
      .single();
    if (error) throw new Error(`createConversation: ${error.message}`);
    return { id: data!.id as string };
  },

  async appendMessage({ conversationId, question, payload, userEmail }) {
    const { error } = await db().from("messages").insert({
      conversation_id: conversationId,
      question,
      payload,
      user_email: userEmail,
    });
    if (error) throw new Error(`appendMessage(insert): ${error.message}`);
    const { error: touchErr } = await db()
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    if (touchErr) throw new Error(`appendMessage(touch): ${touchErr.message}`);
  },

  async listConversations() {
    const { data, error } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`listConversations: ${error.message}`);
    return (data ?? []).map(toSummary);
  },

  async getConversation(id) {
    const { data: conv, error: cErr } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .eq("id", id)
      .single();
    if (cErr) throw new Error(`getConversation(conversation): ${cErr.message}`);
    const { data: rows, error: mErr } = await db()
      .from("messages")
      .select("id, question, payload, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (mErr) throw new Error(`getConversation(messages): ${mErr.message}`);
    return {
      conversation: toSummary(conv as Record<string, unknown>),
      messages: (rows ?? []).map((r) =>
        hydrateMessage(r.id as string, r.question as string, r.payload)
      ),
    };
  },

  async deleteConversation(id) {
    const { error } = await db().from("conversations").delete().eq("id", id);
    if (error) throw new Error(`deleteConversation: ${error.message}`);
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/integrations/ulink-agent/conversations.test.ts`
Expected: PASS (`deriveTitle` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/conversations.ts src/lib/integrations/ulink-agent/conversations.test.ts
git commit -m "feat(agent): conversation store + deriveTitle"
```

---

### Task 5: `persistTurn`

Pure orchestration over a `ConversationStore`: reduce events into a payload, create the
conversation if needed, append the turn. Tested against an in-memory fake store.

**Files:**
- Modify: `src/lib/integrations/ulink-agent/conversations.ts`
- Test: `src/lib/integrations/ulink-agent/conversations.test.ts`

- [ ] **Step 1: Write failing tests for `persistTurn`**

Append to `src/lib/integrations/ulink-agent/conversations.test.ts`:

```ts
import { persistTurn, type ConversationStore } from "./conversations";
import type { AgentEvent } from "./events";
import type { AgentMessage } from "./message";

function fakeStore() {
  const calls = {
    created: [] as { title: string; userEmail: string | null }[],
    appended: [] as {
      conversationId: string;
      question: string;
      payload: AgentMessage;
      userEmail: string | null;
    }[],
  };
  const store: ConversationStore = {
    createConversation: async (input) => {
      calls.created.push(input);
      return { id: "new-convo-id" };
    },
    appendMessage: async (input) => {
      calls.appended.push(input);
    },
    listConversations: async () => [],
    getConversation: async () => {
      throw new Error("unused");
    },
    deleteConversation: async () => {},
  };
  return { store, calls };
}

const events: AgentEvent[] = [
  { type: "narration", delta: "You have 5 links." },
  { type: "done", logId: "log-1" },
];

describe("persistTurn", () => {
  it("creates a conversation on the first turn and appends the message", async () => {
    const { store, calls } = fakeStore();
    const out = await persistTurn(store, {
      question: "how many links?",
      conversationId: null,
      userEmail: "pm@x.com",
      events,
    });
    expect(out.conversationId).toBe("new-convo-id");
    expect(out.title).toBe("how many links?");
    expect(calls.created).toHaveLength(1);
    expect(calls.appended).toHaveLength(1);
    expect(calls.appended[0].conversationId).toBe("new-convo-id");
    expect(calls.appended[0].payload.narration).toBe("You have 5 links.");
    expect(calls.appended[0].payload.logId).toBe("log-1");
  });

  it("reuses an existing conversation id without creating one", async () => {
    const { store, calls } = fakeStore();
    const out = await persistTurn(store, {
      question: "now by month",
      conversationId: "existing-id",
      userEmail: "pm@x.com",
      events,
    });
    expect(out.conversationId).toBe("existing-id");
    expect(calls.created).toHaveLength(0);
    expect(calls.appended[0].conversationId).toBe("existing-id");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integrations/ulink-agent/conversations.test.ts`
Expected: FAIL — `persistTurn` is not exported.

- [ ] **Step 3: Implement `persistTurn` in `conversations.ts`**

Add imports at the top of `conversations.ts`:

```ts
import type { AgentEvent } from "./events";
import { applyEvent, emptyMessage } from "./message";
```

Add at the end of the file:

```ts
export async function persistTurn(
  store: ConversationStore,
  input: {
    question: string;
    conversationId: string | null;
    userEmail: string | null;
    events: AgentEvent[];
  }
): Promise<{ conversationId: string; title: string }> {
  const payload = input.events.reduce(applyEvent, emptyMessage("", input.question));
  const title = deriveTitle(input.question);
  let conversationId = input.conversationId;
  if (!conversationId) {
    const created = await store.createConversation({ title, userEmail: input.userEmail });
    conversationId = created.id;
  }
  await store.appendMessage({
    conversationId,
    question: input.question,
    payload,
    userEmail: input.userEmail,
  });
  return { conversationId, title };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/integrations/ulink-agent/conversations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ulink-agent/conversations.ts src/lib/integrations/ulink-agent/conversations.test.ts
git commit -m "feat(agent): persistTurn orchestration"
```

---

### Task 6: Shared session helper + query route persistence

**Files:**
- Create: `src/lib/auth/session.ts`
- Modify: `src/app/api/agent/query/route.ts`

- [ ] **Step 1: Create the shared session helper**

`src/lib/auth/session.ts`:

```ts
import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

// Returns the signed-in user's email, or null if the session cookie is absent/invalid.
export async function getSessionEmail(request: NextRequest): Promise<string | null> {
  const session = request.cookies.get("fw_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded.email ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Rewrite `query/route.ts` to use the helper, collect events, and persist**

Replace the entire contents of `src/app/api/agent/query/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { runAgent } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient, getFastClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { conversationStore, persistTurn } from "@/lib/integrations/ulink-agent/conversations";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import { getSessionEmail } from "@/lib/auth/session";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";

export const dynamic = "force-dynamic";
// R1 is slow; the loop may make several calls. Allow up to 60s (raise on Pro/Fluid).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { question?: unknown; history?: unknown; conversationId?: unknown };
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
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const userEmail = await getSessionEmail(request);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const collected: AgentEvent[] = [];
      const emit = (e: AgentEvent) => {
        collected.push(e);
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
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
      }

      // Persist the turn (best-effort: never break the answer if storage fails).
      try {
        const { conversationId: id, title } = await persistTurn(conversationStore, {
          question,
          conversationId,
          userEmail,
          events: collected,
        });
        emit({ type: "conversation", conversationId: id, title });
      } catch (persistErr) {
        console.error("Persist turn failed:", persistErr);
      }

      controller.close();
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

Note: the `conversation` event is emitted **after** `done`/`error` (the loop already emitted
those). The client handles `conversation` independently of message finalization, so order is
fine.

- [ ] **Step 3: Verify the build and full test suite**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass (no route unit test — verified manually in Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/session.ts src/app/api/agent/query/route.ts
git commit -m "feat(agent): persist each turn from the query route"
```

---

### Task 7: Conversation list / load / delete API routes

Thin glue over `conversationStore` + `getSessionEmail`. Verified by build + manual smoke
(Task 10), consistent with the existing untested routes.

**Files:**
- Create: `src/app/api/agent/conversations/route.ts`
- Create: `src/app/api/agent/conversations/[id]/route.ts`

- [ ] **Step 1: Create the list route**

`src/app/api/agent/conversations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/integrations/ulink-agent/conversations";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const conversations = await conversationStore.listConversations();
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("listConversations failed:", err);
    return NextResponse.json({ error: "Could not list conversations" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Create the get-one / delete route**

`src/app/api/agent/conversations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/integrations/ulink-agent/conversations";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await conversationStore.getConversation(params.id);
    return NextResponse.json(data);
  } catch (err) {
    console.error("getConversation failed:", err);
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await conversationStore.deleteConversation(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteConversation failed:", err);
    return NextResponse.json({ error: "Could not delete conversation" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds (both routes compile).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/conversations
git commit -m "feat(agent): conversation list/load/delete API routes"
```

---

### Task 8: `useConversationList` hook

**Files:**
- Create: `src/hooks/use-conversation-list.ts`

- [ ] **Step 1: Create the hook**

`src/hooks/use-conversation-list.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";

export function useConversationList() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    // Optimistic removal.
    setConversations((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" });
    } catch {
      /* best-effort; refresh will reconcile on next mount */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, refresh, remove };
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-conversation-list.ts
git commit -m "feat(agent): useConversationList hook"
```

---

### Task 9: Extend `useAgentStream` with conversation state

Adds `conversationId`, sends it on `ask`, surfaces `conversation` events via a callback,
adds `load(id)` (hydrate from the GET endpoint) and `newChat()`.

**Files:**
- Modify: `src/hooks/use-agent-stream.ts`

- [ ] **Step 1: Update imports and hook signature**

At the top of `use-agent-stream.ts`, extend the imports added in Task 2 to also pull in
`hydrateMessage` and the summary type:

```ts
import {
  applyEvent,
  emptyMessage,
  hydrateMessage,
  type AgentMessage,
  type AgentStep,
} from "@/lib/integrations/ulink-agent/message";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";
```

Change the hook to accept an `onConversation` callback and track `conversationId`:

```ts
export function useAgentStream(onConversation?: (summary: { id: string; title: string }) => void) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
```

- [ ] **Step 2: Send `conversationId` and handle the `conversation` event in `ask`**

In `ask`, include `conversationId` in the POST body:

```ts
        body: JSON.stringify({ question, history, conversationId }),
```

In the `consume` function, intercept the `conversation` event before applying it to the
message:

```ts
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as AgentEvent;
          if (event.type === "conversation") {
            setConversationId(event.conversationId);
            onConversation?.({ id: event.conversationId, title: event.title });
            return;
          }
          update((m) => applyEvent(m, event));
        } catch {
          /* skip malformed line */
        }
      };
```

- [ ] **Step 3: Add `load` and `newChat`**

Add inside the hook, before the `return`:

```ts
  async function load(id: string) {
    try {
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversation: ConversationSummary;
        messages: AgentMessage[];
      };
      setMessages(data.messages.map((m) => ({ ...m, loading: false })));
      setConversationId(id);
    } catch {
      /* best-effort */
    }
  }

  function newChat() {
    setMessages([]);
    setConversationId(null);
  }
```

- [ ] **Step 4: Return the new surface**

Update the `return`:

```ts
  return { messages, conversationId, ask, sendFeedback, load, newChat };
```

- [ ] **Step 5: Verify the build + tests**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass (the reducer test is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-agent-stream.ts
git commit -m "feat(agent): conversation state, load, and newChat in useAgentStream"
```

---

### Task 10: Sidebar component + two-column page

**Files:**
- Create: `src/components/agent/conversation-sidebar.tsx`
- Modify: `src/app/(dashboard)/agent/page.tsx`

- [ ] **Step 1: Create the sidebar component**

`src/components/agent/conversation-sidebar.tsx`:

```tsx
"use client";

import { formatDistanceToNow } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";

export function ConversationSidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/50 pr-3">
      <button
        onClick={onNew}
        className="mb-3 flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        <Plus className="h-4 w-4" /> New chat
      </button>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No saved chats yet.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              c.id === activeId && "bg-accent"
            )}
            onClick={() => onSelect(c.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                {c.createdByEmail ? ` · ${c.createdByEmail}` : ""}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              aria-label="Delete chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Rewrite `page.tsx` as a two-column layout**

Replace the entire contents of `src/app/(dashboard)/agent/page.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useConversationList } from "@/hooks/use-conversation-list";
import { AgentMessage } from "@/components/agent/agent-message";
import { ConversationSidebar } from "@/components/agent/conversation-sidebar";

export default function AgentPage() {
  const list = useConversationList();
  const onConversation = useCallback(() => {
    void list.refresh();
  }, [list]);
  const { messages, conversationId, ask, sendFeedback, load, newChat } =
    useAgentStream(onConversation);
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prevLenRef = useRef(0);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const newMessage = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    if (newMessage) stickRef.current = true;
    if (newMessage || stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void ask(q);
  }

  function handleDelete(id: string) {
    void list.remove(id);
    if (id === conversationId) newChat();
  }

  return (
    <div className="flex h-full gap-4">
      <ConversationSidebar
        conversations={list.conversations}
        activeId={conversationId}
        onNew={newChat}
        onSelect={(id) => void load(id)}
        onDelete={handleDelete}
      />

      <div className="mx-auto flex h-full max-w-3xl flex-1 flex-col">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about ULink in plain English — it explains the answer and shows the data. Read-only.
          </p>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="mt-6 flex-1 space-y-6 overflow-y-auto pb-4"
        >
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
    </div>
  );
}
```

- [ ] **Step 3: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm test`
Expected: all succeed.

- [ ] **Step 4: Manual smoke test (dev server already on :3002)**

Verify end-to-end:
1. Ask a question → answer streams as before.
2. A new chat appears in the sidebar with a title from the question.
3. Refresh the page → the chat is still listed; click it → the full turn (narration, table,
   thinking panel) re-renders.
4. Ask a follow-up in that chat → it appends to the same conversation (sidebar entry moves to
   top, `updated_at` fresh).
5. "New chat" → clears the pane; asking starts a fresh conversation.
6. Trash icon → removes the chat; deleting the active one resets to a new chat.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/conversation-sidebar.tsx "src/app/(dashboard)/agent/page.tsx"
git commit -m "feat(agent): conversation sidebar + two-column chat layout"
```

---

## After all tasks

- Run the full suite once more: `npm test && npm run lint && npm run build`.
- Dispatch a final code review over the whole change set.
- Use `superpowers:finishing-a-development-branch` to complete the work (the dev→main PR via
  merge commit, per the project's `dev→main` rule, if this was done on a branch).
