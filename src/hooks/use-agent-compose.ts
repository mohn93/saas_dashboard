"use client";

import { useCallback, useState } from "react";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import { applyEvent, emptyMessage, type AgentMessage } from "@/lib/integrations/ulink-agent/message";

export function useAgentCompose() {
  const [message, setMessage] = useState<AgentMessage | null>(null);

  const update = (fn: (m: AgentMessage) => AgentMessage) =>
    setMessage((m) => (m ? fn(m) : m));

  const run = useCallback(async (question: string) => {
    setMessage(emptyMessage("compose", question));
    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: [], persist: false }),
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
          if (event.type === "conversation") return; // never emitted with persist:false, but ignore
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
      update((m) => ({ ...m, loading: false, phase: "error", error: m.error ?? "Network error" }));
    }
  }, []);

  const reset = useCallback(() => setMessage(null), []);

  return { message, run, reset };
}
