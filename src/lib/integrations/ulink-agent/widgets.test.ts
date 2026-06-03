import { describe, expect, it } from "vitest";
import {
  STALE_MS,
  deriveWidgetKind,
  isStale,
  sizeToCols,
  applyReorder,
  capRows,
  widgetFromAnswer,
  canChart,
  inferChartSpec,
  pickInitialKind,
  resolveWidgetChart,
} from "./widgets";
import type { QueryResult } from "./types";

const oneByOne: QueryResult = { columns: ["mau"], rows: [{ mau: 51884 }], rowCount: 1 };
const multi: QueryResult = {
  columns: ["day", "n"],
  rows: [{ day: "2026-06-01", n: 5 }, { day: "2026-06-02", n: 8 }],
  rowCount: 2,
};

describe("deriveWidgetKind", () => {
  it("returns table for a null result", () => {
    expect(deriveWidgetKind(null, null)).toBe("table");
  });
  it("returns kpi for a single numeric cell", () => {
    expect(deriveWidgetKind(oneByOne, null)).toBe("kpi");
  });
  it("returns chart when a usable chart spec is present", () => {
    expect(
      deriveWidgetKind(multi, { type: "line", xColumn: "day", yColumn: "n" })
    ).toBe("chart");
  });
  it("returns table for multi-column data with no chart", () => {
    expect(deriveWidgetKind(multi, { type: "none", xColumn: null, yColumn: null })).toBe("table");
  });
});

describe("isStale", () => {
  const now = 1_000_000_000_000;
  it("is stale when cachedAt is null", () => {
    expect(isStale(null, now)).toBe(true);
  });
  it("is stale when older than STALE_MS", () => {
    expect(isStale(new Date(now - STALE_MS - 1).toISOString(), now)).toBe(true);
  });
  it("is fresh when within STALE_MS", () => {
    expect(isStale(new Date(now - 1000).toISOString(), now)).toBe(false);
  });
});

describe("sizeToCols", () => {
  it("maps sizes to column spans", () => {
    expect(sizeToCols("sm")).toBe(4);
    expect(sizeToCols("md")).toBe(6);
    expect(sizeToCols("full")).toBe(12);
  });
});

describe("applyReorder", () => {
  it("maps array order to positions", () => {
    expect(applyReorder(["c", "a", "b"])).toEqual({ c: 0, a: 1, b: 2 });
  });
});

describe("capRows", () => {
  it("returns null for null", () => {
    expect(capRows(null, 100)).toBeNull();
  });
  it("caps rows but preserves the true rowCount", () => {
    const big: QueryResult = {
      columns: ["x"],
      rows: Array.from({ length: 250 }, (_, i) => ({ x: i })),
      rowCount: 250,
    };
    const out = capRows(big, 100)!;
    expect(out.rows).toHaveLength(100);
    expect(out.rowCount).toBe(250);
  });
});

describe("widgetFromAnswer", () => {
  it("builds a query widget with derived kind and title", () => {
    const w = widgetFromAnswer({
      question: "production MAU",
      sql: "select count(*) ...",
      chart: null,
      result: oneByOne,
    });
    expect(w.kind).toBe("kpi");
    expect(w.title).toBe("production MAU");
    expect(w.size).toBe("md");
    expect(w.sql).toBe("select count(*) ...");
    expect(w.result).toEqual(oneByOne);
    expect(w.textMd).toBeNull();
  });
  it("honors explicit overrides", () => {
    const w = widgetFromAnswer({
      question: "signups by day",
      sql: "select ...",
      chart: { type: "bar", xColumn: "day", yColumn: "n" },
      result: multi,
      title: "Signups",
      size: "full",
      kind: "table",
    });
    expect(w.title).toBe("Signups");
    expect(w.size).toBe("full");
    expect(w.kind).toBe("table");
  });
});

describe("canChart / inferChartSpec", () => {
  const chartable: QueryResult = {
    columns: ["month", "n"],
    rows: [{ month: "2026-04", n: 4 }, { month: "2026-05", n: 2 }],
    rowCount: 2,
  };
  const allText: QueryResult = {
    columns: ["a", "b"],
    rows: [{ a: "x", b: "y" }],
    rowCount: 1,
  };

  it("canChart true for a label + numeric column", () => {
    expect(canChart(chartable)).toBe(true);
  });
  it("canChart false for all-text or null/empty", () => {
    expect(canChart(allText)).toBe(false);
    expect(canChart(null)).toBe(false);
    expect(canChart({ columns: ["n"], rows: [], rowCount: 0 })).toBe(false);
  });
  it("inferChartSpec picks label x + numeric y, default bar", () => {
    expect(inferChartSpec(chartable)).toEqual({ type: "bar", xColumn: "month", yColumn: "n" });
  });
  it("inferChartSpec honors a passed type", () => {
    expect(inferChartSpec(chartable, "pie")).toEqual({ type: "pie", xColumn: "month", yColumn: "n" });
  });
  it("inferChartSpec returns null when not chartable", () => {
    expect(inferChartSpec(allText)).toBeNull();
  });
});

describe("pickInitialKind", () => {
  const oneByOne: QueryResult = { columns: ["mau"], rows: [{ mau: 5 }], rowCount: 1 };
  const series: QueryResult = {
    columns: ["m", "n"],
    rows: [{ m: "a", n: 1 }],
    rowCount: 1,
  };
  const usableChart = { type: "pie" as const, xColumn: "m", yColumn: "n" };

  it("returns kpi for a 1x1 numeric result", () => {
    expect(pickInitialKind(oneByOne, null, "both")).toBe("kpi");
  });
  it("returns chart when display is chart/both and chartable", () => {
    expect(pickInitialKind(series, null, "chart")).toBe("chart");
    expect(pickInitialKind(series, usableChart, "both")).toBe("chart");
  });
  it("returns table when display is table even if chartable", () => {
    expect(pickInitialKind(series, usableChart, "table")).toBe("table");
  });
});

describe("resolveWidgetChart", () => {
  const series: QueryResult = { columns: ["m", "n"], rows: [{ m: "a", n: 1 }], rowCount: 1 };
  it("forces the chosen type onto an existing usable chart", () => {
    const base = { type: "bar" as const, xColumn: "m", yColumn: "n" };
    expect(resolveWidgetChart(series, base, "chart", "pie")).toEqual({ type: "pie", xColumn: "m", yColumn: "n" });
  });
  it("infers a chart when there is no usable base chart", () => {
    expect(resolveWidgetChart(series, null, "chart", "line")).toEqual({ type: "line", xColumn: "m", yColumn: "n" });
  });
  it("returns the base chart unchanged for non-chart kinds", () => {
    const base = { type: "bar" as const, xColumn: "m", yColumn: "n" };
    expect(resolveWidgetChart(series, base, "table", "pie")).toBe(base);
  });
});
