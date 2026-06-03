"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import { applyEvent, emptyMessage, type AgentMessage } from "@/lib/integrations/ulink-agent/message";

export function useAgentCompose() {
  const [message, setMessage] = useState<AgentMessage | null>(null);
  // Re-running while a previous compose is still streaming must not let the old
  // stream write onto the new preview: each run gets a token + abort signal.
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  const update = (fn: (m: AgentMessage) => AgentMessage) =>
    setMessage((m) => (m ? fn(m) : m));

  const run = useCallback(async (question: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runToken = ++runRef.current;
    const isCurrent = () => runRef.current === runToken && !controller.signal.aborted;

    setMessage(emptyMessage("compose", question));
    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: [], persist: false }),
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
          if (event.type === "conversation") return; // never emitted with persist:false, but ignore
          if (isCurrent()) update((m) => applyEvent(m, event));
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
      if (isCurrent()) update((m) => (m.loading ? { ...m, loading: false } : m));
    } catch (err) {
      if (isCurrent() && !(err instanceof DOMException && err.name === "AbortError")) {
        update((m) => ({ ...m, loading: false, phase: "error", error: m.error ?? "Network error" }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runRef.current += 1;
    setMessage(null);
  }, []);

  return { message, run, reset };
}
