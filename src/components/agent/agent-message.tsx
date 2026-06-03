"use client";

import { useState } from "react";
import { ChevronRight, Loader2, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResultView } from "@/components/agent/result-view";
import { Markdown } from "@/components/agent/markdown";
import { stripMarkdownTables } from "@/lib/markdown-utils";
import { buildAnswer } from "@/lib/integrations/ulink-agent/widgets";
import { PinToDashboard } from "@/components/agent/pin-to-dashboard";
import type { AgentMessage as AgentMessageType } from "@/hooks/use-agent-stream";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";

const PHASE_LABEL: Record<string, string> = {
  idle: "Starting…",
  working: "Thinking…",
  running: "Running query…",
  done: "Done",
  error: "Error",
};

export function AgentMessage({
  message,
  onFeedback,
}: {
  message: AgentMessageType;
  onFeedback: (messageId: string, logId: string, helpful: boolean) => void;
}) {
  const finished = !message.loading;
  // Expanded while running; collapses once finished. User can re-open.
  const [open, setOpen] = useState(true);

  // Auto-collapse: when it finishes, default the panel closed (unless user opened).
  const [userToggled, setUserToggled] = useState(false);
  const panelOpen = userToggled ? open : !finished;

  const resultAnswer: AgentAnswer | null = message.result
    ? buildAnswer({ sql: message.sql, chart: message.chart, result: message.result })
    : null;

  // Strip any inline markdown table from the narration when the result table renders below it.
  const displayNarration = message.result
    ? stripMarkdownTables(message.narration)
    : message.narration;

  return (
    <div className="space-y-3">
      {/* user question */}
      <div className="rounded-lg bg-accent/40 px-3 py-2 text-sm font-medium">
        {message.question}
      </div>

      {/* thinking panel */}
      {(message.steps.length > 0 || message.reasoning.length > 0) && (
        <div className="rounded-lg border border-border/50">
          <button
            onClick={() => {
              setUserToggled(true);
              setOpen(!panelOpen);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {message.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", panelOpen && "rotate-90")}
              />
            )}
            {message.loading ? PHASE_LABEL[message.phase] ?? "Working…" : "Thinking"}
          </button>
          {panelOpen && (
            <div className="space-y-2 border-t border-border/50 px-3 py-2">
              {message.steps.map((s, i) => (
                <div key={i} className="text-xs">
                  <span className="text-foreground">{s.label}</span>
                  {s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
                </div>
              ))}
              {message.reasoning && (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/80">
                  {message.reasoning}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* error */}
      {message.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {message.error}
        </div>
      )}

      {/* narration (inline markdown table stripped when the result table renders below) */}
      {displayNarration && (
        <div className="flex gap-2 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <Markdown className="min-w-0 flex-1">{displayNarration}</Markdown>
        </div>
      )}

      {/* result table/chart */}
      {resultAnswer && <ResultView answer={resultAnswer} display={message.display} />}

      {/* feedback + pin */}
      {finished && !message.error && (message.logId || message.result) && (
        <div className="flex items-center gap-2">
          {message.logId && (
            <>
              <button
                onClick={() => onFeedback(message.id, message.logId!, true)}
                aria-label="Helpful"
                aria-pressed={message.feedback === "up"}
                className={cn(
                  "rounded-md p-1.5 hover:bg-accent",
                  message.feedback === "up" && "bg-green-500/15 text-green-400"
                )}
              >
                <ThumbsUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => onFeedback(message.id, message.logId!, false)}
                aria-label="Not helpful"
                aria-pressed={message.feedback === "down"}
                className={cn(
                  "rounded-md p-1.5 hover:bg-accent",
                  message.feedback === "down" && "bg-red-500/15 text-red-400"
                )}
              >
                <ThumbsDown className="h-4 w-4" />
              </button>
              {message.feedback === "up" && (
                <span className="text-xs text-muted-foreground">Saved as a trusted example</span>
              )}
            </>
          )}
          {message.result && <PinToDashboard message={message} />}
        </div>
      )}
    </div>
  );
}
