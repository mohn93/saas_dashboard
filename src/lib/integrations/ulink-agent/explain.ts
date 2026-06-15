import type { QueryResult } from "./types";

export interface CostEstimate {
  cost: number;
  rows: number;
}

export interface Budget {
  maxCost: number;
  maxRows: number;
}

// Read { "Total Cost", "Plan Rows" } from the top node of EXPLAIN (FORMAT JSON).
// pg may hand the JSON back as a string, an array, or an object depending on
// driver settings, so normalize all three.
export function parseExplainResult(rows: Record<string, unknown>[]): CostEstimate | null {
  const first = rows[0];
  if (!first) return null;
  let plan: unknown = first["QUERY PLAN"];
  if (typeof plan === "string") {
    try {
      plan = JSON.parse(plan);
    } catch {
      return null;
    }
  }
  const node = Array.isArray(plan) ? plan[0] : plan;
  const top = (node as { Plan?: unknown } | null)?.Plan as
    | { "Total Cost"?: unknown; "Plan Rows"?: unknown }
    | undefined;
  if (!top) return null;
  const cost = top["Total Cost"];
  const planRows = top["Plan Rows"];
  if (typeof cost !== "number" || typeof planRows !== "number") return null;
  return { cost, rows: planRows };
}

export function exceedsBudget(est: CostEstimate, budget: Budget): boolean {
  return est.cost > budget.maxCost || est.rows > budget.maxRows;
}

// Env-driven config. Defaults are effectively "off" so the gate ships in shadow
// mode (log only) until ULINK_AGENT_GATE_ENABLED=true and thresholds are tuned.
export function gateConfig(): { enabled: boolean; budget: Budget } {
  return {
    enabled: process.env.ULINK_AGENT_GATE_ENABLED === "true",
    budget: {
      maxCost: Number(process.env.ULINK_AGENT_MAX_PLAN_COST || Number.MAX_SAFE_INTEGER),
      maxRows: Number(process.env.ULINK_AGENT_MAX_PLAN_ROWS || Number.MAX_SAFE_INTEGER),
    },
  };
}

// Run EXPLAIN (no ANALYZE — plans only, never executes) and parse the estimate.
// Returns null if EXPLAIN fails or the output can't be parsed; callers treat a
// null estimate as "don't gate" (fail open — statement_timeout is the backstop).
export async function estimateCost(
  execute: (sql: string) => Promise<QueryResult>,
  wrappedSql: string
): Promise<CostEstimate | null> {
  try {
    const res = await execute(`EXPLAIN (FORMAT JSON) ${wrappedSql}`);
    return parseExplainResult(res.rows);
  } catch {
    return null;
  }
}
