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
