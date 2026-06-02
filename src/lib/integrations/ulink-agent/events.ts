import type { ChartSpec } from "./types";

export type AgentPhase =
  | "planning"
  | "selecting"
  | "writing"
  | "running"
  | "narrating"
  | "done"
  | "error";

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
    }
  | { type: "narration"; delta: string }
  | { type: "done"; logId: string | null }
  | { type: "error"; error: string };
