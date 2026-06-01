"use client";

import { useState } from "react";
import { Send, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { useAgentQuery } from "@/hooks/use-agent-query";
import { ResultView } from "@/components/agent/result-view";
import { cn } from "@/lib/utils";

export default function AgentPage() {
  const { messages, ask, sendFeedback } = useAgentQuery();
  const [input, setInput] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void ask(q);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask questions about ULink in plain English. Read-only.
        </p>
      </div>

      <div className="mt-6 flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            e.g. &ldquo;How many signups per week over the last 8 weeks?&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-3">
            <div className="rounded-lg bg-accent/40 px-3 py-2 text-sm font-medium">
              {m.question}
            </div>
            {m.loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            )}
            {m.answer && <ResultView answer={m.answer} />}
            {m.answer?.ok && m.answer.logId && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => sendFeedback(m.id, m.answer!.logId!, true)}
                  className={cn(
                    "rounded-md p-1.5 hover:bg-accent",
                    m.feedback === "up" && "text-green-400"
                  )}
                  aria-label="Helpful"
                >
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => sendFeedback(m.id, m.answer!.logId!, false)}
                  className={cn(
                    "rounded-md p-1.5 hover:bg-accent",
                    m.feedback === "down" && "text-red-400"
                  )}
                  aria-label="Not helpful"
                >
                  <ThumbsDown className="h-4 w-4" />
                </button>
                {m.feedback === "up" && (
                  <span className="text-xs text-muted-foreground">
                    Saved as a trusted example
                  </span>
                )}
              </div>
            )}
          </div>
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
  );
}
