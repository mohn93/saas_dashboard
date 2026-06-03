import type { AgentEvent, AgentPhase } from "./events";
import type { ChartSpec, DisplayMode, QueryResult } from "./types";

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
  display: DisplayMode;
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
    display: "both",
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
        display: e.display,
      };
    case "narration":
      return { ...m, narration: m.narration + e.delta };
    case "done":
      return { ...m, logId: e.logId, loading: false, phase: "done" };
    case "error":
      return { ...m, error: e.error, loading: false, phase: "error" };
    case "conversation":
      return m; // conversation-level signal; handled by the hook, not the message
    default:
      return m;
  }
}

export function hydrateMessage(
  id: string,
  question: string,
  payload: unknown
): AgentMessage {
  const base = emptyMessage(id, question);
  const p = (payload ?? {}) as Partial<AgentMessage>;
  return { ...base, ...p, id, question, loading: false };
}
