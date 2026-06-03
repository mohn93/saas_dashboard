import { describe, it, expect } from "vitest";
import { humanizeIsoDate, axisLabel, chartLabels, pageBounds } from "./format";

describe("humanizeIsoDate", () => {
  it("humanizes a date-only ISO string without a time", () => {
    const d = humanizeIsoDate("2026-05-06");
    expect(d).not.toBeNull();
    expect(d!.display).toBe("May 6, 2026");
    expect(d!.exact).toContain("2026");
    expect(d!.exact).not.toMatch(/\d{2}:\d{2}/); // no time component
  });

  it("humanizes an ISO datetime and includes a time in both forms", () => {
    const d = humanizeIsoDate("2026-05-06T14:30:00.000Z");
    expect(d).not.toBeNull();
    expect(d!.display).toMatch(/May 6, 2026/);
    expect(d!.display).toMatch(/[AP]M$/);
    expect(d!.exact).toMatch(/:\d{2}:\d{2}/); // seconds in the exact form
  });

  it("returns null for non-date strings and non-strings", () => {
    expect(humanizeIsoDate("hello")).toBeNull();
    expect(humanizeIsoDate("123")).toBeNull();
    expect(humanizeIsoDate(42)).toBeNull();
    expect(humanizeIsoDate(null)).toBeNull();
  });

  it("returns null for an ISO-shaped but invalid date", () => {
    expect(humanizeIsoDate("2026-13-45")).toBeNull();
  });
});

describe("axisLabel", () => {
  it("humanizes ISO dates", () => {
    expect(axisLabel("2025-08-29T00:00:00.000Z")).toBe("Aug 29, 2025");
  });

  it("passes non-date values through as strings", () => {
    expect(axisLabel("booker")).toBe("booker");
    expect(axisLabel(7)).toBe("7");
  });

  it("renders null/undefined as an empty label", () => {
    expect(axisLabel(null)).toBe("");
    expect(axisLabel(undefined)).toBe("");
  });
});

describe("chartLabels", () => {
  it("uses clean date-only labels for distinct day buckets", () => {
    // The exact case from the PM screenshot: midnight-bucket datetimes per day.
    expect(
      chartLabels([
        "2025-08-29T00:00:00.000Z",
        "2025-10-26T00:00:00.000Z",
        "2026-02-22T00:00:00.000Z",
      ])
    ).toEqual(["Aug 29, 2025", "Oct 26, 2025", "Feb 22, 2026"]);
  });

  it("falls back to the fuller (timed) label when date-only would collide", () => {
    // Two timestamps on the same calendar day must not collapse to one label.
    const out = chartLabels([
      "2026-05-06T09:00:00.000Z",
      "2026-05-06T15:00:00.000Z",
    ]);
    expect(new Set(out).size).toBe(2);
    out.forEach((l) => expect(l).toMatch(/May 6, 2026/));
  });

  it("passes non-date categories through unchanged", () => {
    expect(chartLabels(["booker", "alpona", "xxx"])).toEqual(["booker", "alpona", "xxx"]);
  });
});

describe("pageBounds", () => {
  it("computes bounds for the first page", () => {
    expect(pageBounds(275, 0, 25)).toEqual({ page: 0, pageCount: 11, start: 0, end: 25 });
  });

  it("computes a partial last page", () => {
    expect(pageBounds(275, 10, 25)).toEqual({ page: 10, pageCount: 11, start: 250, end: 275 });
  });

  it("clamps a page past the end to the last page", () => {
    expect(pageBounds(50, 99, 25)).toEqual({ page: 1, pageCount: 2, start: 25, end: 50 });
  });

  it("clamps a negative page to the first page", () => {
    expect(pageBounds(50, -3, 25)).toEqual({ page: 0, pageCount: 2, start: 0, end: 25 });
  });

  it("returns a single empty page for zero rows", () => {
    expect(pageBounds(0, 0, 25)).toEqual({ page: 0, pageCount: 1, start: 0, end: 0 });
  });

  it("guards against a zero page size", () => {
    const b = pageBounds(10, 0, 0);
    expect(b.pageCount).toBe(10);
    expect(b.end).toBe(1);
  });
});
