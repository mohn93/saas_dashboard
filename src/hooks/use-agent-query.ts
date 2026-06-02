"use client";

import { useState } from "react";
import type {
  AgentAnswer,
  ConversationTurn,
} from "@/lib/integrations/ulink-agent/types";

export interface AgentMessage {
  id: string;
  question: string;
  answer: AgentAnswer | null;
  loading: boolean;
  feedback: "up" | "down" | null;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

export function useAgentQuery() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  async function ask(question: string) {
    const id = nextId();
    setMessages((prev) => [
      ...prev,
      { id, question, answer: null, loading: true, feedback: null },
    ]);

    // Include ALL answered turns (success AND failure) so follow-ups like
    // "try again" / "fix it" / "now by month" have the prior question + error.
    const history: ConversationTurn[] = messages
      .filter((m) => m.answer)
      .map((m) => ({
        question: m.question,
        sql: m.answer!.sql,
        ok: m.answer!.ok,
        error: m.answer!.error,
      }));

    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const answer = (await res.json()) as AgentAnswer;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, answer, loading: false } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                loading: false,
                answer: {
                  ok: false,
                  sql: null,
                  chart: null,
                  result: null,
                  error: "Network error",
                  attempts: 0,
                  logId: null,
                },
              }
            : m
        )
      );
    }
  }

  async function sendFeedback(messageId: string, logId: string, helpful: boolean) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, feedback: helpful ? "up" : "down" } : m
      )
    );
    try {
      await fetch("/api/agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, helpful }),
      });
    } catch {
      /* feedback is best-effort */
    }
  }

  return { messages, ask, sendFeedback };
}
