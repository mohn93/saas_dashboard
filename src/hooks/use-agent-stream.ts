"use client";

import { useRef, useState } from "react";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import type { ConversationTurn, ConversationSummary } from "@/lib/integrations/ulink-agent/types";
import {
  applyEvent,
  emptyMessage,
  type AgentMessage,
} from "@/lib/integrations/ulink-agent/message";

// Re-exported for backward compatibility — prefer importing directly from
// @/lib/integrations/ulink-agent/message in server-usable code.
export { applyEvent, emptyMessage };
export type { AgentMessage };

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

export function useAgentStream(
  onConversation?: (summary: { id: string; title: string }) => void
) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cancellation: each run gets a monotonic token; switching conversations,
  // starting a new chat, or asking again aborts the in-flight fetch and
  // invalidates its token so a late stream can't clobber the current view.
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  function cancelInFlight() {
    abortRef.current?.abort();
    abortRef.current = null;
    runRef.current += 1; // invalidate any run still in its read loop
  }

  async function ask(question: string) {
    if (busy) return; // double-submit guard — one stream at a time
    setBusy(true);
    cancelInFlight();
    const controller = new AbortController();
    abortRef.current = controller;
    const runToken = runRef.current;
    const isCurrent = () => runRef.current === runToken && !controller.signal.aborted;

    const id = nextId();
    const history: ConversationTurn[] = messages
      .filter((m) => !m.loading)
      .map((m) => ({
        question: m.question,
        sql: m.sql,
        ok: m.error === null,
        error: m.error,
        // the assistant's reply (data narration or chat reply both land in `narration`)
        answer: m.narration ? m.narration : null,
      }));

    setMessages((prev) => [...prev, emptyMessage(id, question)]);

    const update = (fn: (m: AgentMessage) => AgentMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, conversationId }),
        signal: controller.signal,
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
          if (event.type === "conversation") {
            // Only adopt the conversation id if this run is still the active one.
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
      // An aborted run was superseded on purpose — leave the (now-removed or
      // replaced) message alone rather than flashing a spurious error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        update((m) => ({
          ...m,
          loading: false,
          phase: "error",
          error: m.error ?? "Network error",
        }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
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

  async function load(id: string) {
    cancelInFlight(); // a stream from the previous conversation must not bleed in
    setBusy(false);
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
    cancelInFlight();
    setBusy(false);
    setMessages([]);
    setConversationId(null);
  }

  return { messages, conversationId, busy, ask, sendFeedback, load, newChat };
}
