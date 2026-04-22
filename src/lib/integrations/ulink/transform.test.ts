import { describe, expect, it } from "vitest";
import { transformBusinessMetrics } from "./transform";

const baseParams = {
  signupsDaily: [],
  subscriptions: [],
  totalPaidUsers: 99,
  activeProjects: 0,
  gaVisitors: 1000,
  startDate: new Date("2026-04-01T00:00:00Z"),
  endDate: new Date("2026-04-30T23:59:59Z"),
};

describe("transformBusinessMetrics — signupToPaidRate (cohort)", () => {
  it("uses paid-in-cohort as numerator, not all-time paid users", () => {
    const metrics = transformBusinessMetrics({
      ...baseParams,
      totalSignups: 20,
      paidInCohort: 2,
      totalPaidUsers: 99, // all-time — must NOT leak into the rate
    });

    expect(metrics.signupToPaidRate).toBeCloseTo(0.1, 10);
  });

  it("returns 0 when there are no signups in the window (avoids division by zero)", () => {
    const metrics = transformBusinessMetrics({
      ...baseParams,
      totalSignups: 0,
      paidInCohort: 0,
    });

    expect(metrics.signupToPaidRate).toBe(0);
  });

  it("caps at 100% in the worst case (every signup converts)", () => {
    const metrics = transformBusinessMetrics({
      ...baseParams,
      totalSignups: 5,
      paidInCohort: 5,
    });

    expect(metrics.signupToPaidRate).toBe(1);
  });

  it("reproduces the bug scenario: short window yields a sane rate, not >100%", () => {
    // Pre-fix: totalPaidUsers=11 / totalSignups=4 = 275%.
    // Post-fix: paidInCohort=1 / totalSignups=4 = 25%.
    const metrics = transformBusinessMetrics({
      ...baseParams,
      totalSignups: 4,
      paidInCohort: 1,
      totalPaidUsers: 11,
    });

    expect(metrics.signupToPaidRate).toBe(0.25);
    expect(metrics.signupToPaidRate).toBeLessThanOrEqual(1);
  });

  it("preserves totalPaidUsers on the output (still a valid standalone KPI)", () => {
    const metrics = transformBusinessMetrics({
      ...baseParams,
      totalSignups: 10,
      paidInCohort: 1,
      totalPaidUsers: 42,
    });

    expect(metrics.totalPaidUsers).toBe(42);
  });
});
