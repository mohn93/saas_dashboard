import { describe, expect, it } from "vitest";
import {
  STALE_MS,
  deriveWidgetKind,
  isStale,
  sizeToCols,
  applyReorder,
  capRows,
  widgetFromAnswer,
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
