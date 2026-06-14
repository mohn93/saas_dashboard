import { describe, it, expect } from "vitest";
import { parseExplainResult, exceedsBudget, estimateCost, type CostEstimate } from "./explain";

describe("parseExplainResult", () => {
  it("reads Total Cost and Plan Rows from EXPLAIN (FORMAT JSON) output", () => {
    // pg returns one row whose single column holds the JSON plan array.
    const rows = [
      { "QUERY PLAN": [{ Plan: { "Total Cost": 12345.6, "Plan Rows": 4200 } }] },
    ];
    expect(parseExplainResult(rows)).toEqual({ cost: 12345.6, rows: 4200 });
  });

  it("handles the plan already being an object (driver-parsed)", () => {
    const rows = [{ "QUERY PLAN": { Plan: { "Total Cost": 1, "Plan Rows": 2 } } }];
    expect(parseExplainResult(rows)).toEqual({ cost: 1, rows: 2 });
  });

  it("handles the QUERY PLAN being a JSON string", () => {
    const rows = [{ "QUERY PLAN": '[{"Plan":{"Total Cost":7,"Plan Rows":9}}]' }];
    expect(parseExplainResult(rows)).toEqual({ cost: 7, rows: 9 });
  });

  it("returns null when the shape is unrecognized", () => {
    expect(parseExplainResult([{ foo: "bar" }])).toBeNull();
    expect(parseExplainResult([])).toBeNull();
  });
});

describe("exceedsBudget", () => {
  const est: CostEstimate = { cost: 1000, rows: 1000 };
  it("trips when cost exceeds the cost limit", () => {
    expect(exceedsBudget(est, { maxCost: 500, maxRows: 100000 })).toBe(true);
  });
  it("trips when rows exceed the row limit", () => {
    expect(exceedsBudget(est, { maxCost: 100000, maxRows: 500 })).toBe(true);
  });
  it("does not trip when both are within budget", () => {
    expect(exceedsBudget(est, { maxCost: 100000, maxRows: 100000 })).toBe(false);
  });
});

describe("estimateCost", () => {
  it("returns the parsed estimate from EXPLAIN output", async () => {
    const execute = async () => ({
      columns: ["QUERY PLAN"],
      rows: [{ "QUERY PLAN": [{ Plan: { "Total Cost": 50, "Plan Rows": 12 } }] }],
      rowCount: 1,
    });
    expect(await estimateCost(execute, "select 1")).toEqual({ cost: 50, rows: 12 });
  });

  it("fails open (returns null) when execute throws", async () => {
    const execute = async () => {
      throw new Error("boom");
    };
    expect(await estimateCost(execute, "select 1")).toBeNull();
  });
});
