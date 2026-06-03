import type { ChartSpec, DisplayMode } from "./types";

export type AgentPhase = "working" | "running" | "done" | "error";

export type AgentEvent =
  | { type: "phase"; phase: AgentPhase }
  | { type: "step"; label: string; detail?: string }
  | { type: "reasoning"; delta: string }
  | { type: "sql"; sql: string }
  | {
      type: "result";
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      chart: ChartSpec | null;
      display: DisplayMode;
    }
  | { type: "narration"; delta: string }
  | { type: "done"; logId: string | null }
  | { type: "error"; error: string }
  | { type: "conversation"; conversationId: string; title: string };
