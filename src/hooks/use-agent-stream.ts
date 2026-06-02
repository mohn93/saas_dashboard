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
