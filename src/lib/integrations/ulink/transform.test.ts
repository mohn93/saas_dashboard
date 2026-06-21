import { describe, expect, it } from "vitest";
import { transformBusinessMetrics } from "./transform";
import type { RawSubscriptionRow } from "./queries";

function makeSub(p: {
  id: string;
  status: string;
  priceMonthly: number;
  createdAt: string;
  canceledAt?: string | null;
  periodStart?: string;
  periodEnd?: string;
}): RawSubscriptionRow {
  return {
    id: p.id,
    status: p.status,
    price_monthly: p.priceMonthly,
    price_yearly: null,
    // ~1 month apart so it's treated as a monthly (not yearly) plan
    current_period_start: p.periodStart ?? "2026-01-01T00:00:00Z",
    current_period_end: p.periodEnd ?? "2026-02-01T00:00:00Z",
    created_at: p.createdAt,
    canceled_at: p.canceledAt ?? null,
  } as RawSubscriptionRow;
}

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

describe("transformBusinessMetrics — MRR over time reflects cancellations", () => {
  // Canceled sub: live before the window, cancels mid-window (2026-04-10).
  const canceledSub = makeSub({
    id: "canceled",
    status: "canceled",
    priceMonthly: 50,
    createdAt: "2026-03-01T00:00:00Z",
    canceledAt: "2026-04-10T12:00:00Z",
  });
  // Active sub: joins mid-window (2026-04-05), never cancels.
  const activeSub = makeSub({
    id: "active",
    status: "active",
    priceMonthly: 30,
    createdAt: "2026-04-05T00:00:00Z",
  });

  const metrics = transformBusinessMetrics({
    ...baseParams,
    totalSignups: 0,
    paidInCohort: 0,
    subscriptions: [canceledSub, activeSub],
  });

  const mrrOn = (date: string) =>
    metrics.mrrOverTime.find((d) => d.date === date)?.mrr;

  it("counts a canceled sub on days before its cancellation", () => {
    expect(mrrOn("2026-04-01")).toBe(50); // only the canceled sub is live yet
    expect(mrrOn("2026-04-09")).toBe(80); // both live (active joined Apr 5)
  });

  it("drops MRR on the cancellation date (the dip)", () => {
    expect(mrrOn("2026-04-10")).toBe(30); // canceled sub no longer counts
    expect(mrrOn("2026-04-30")).toBe(30);
  });

  it("produces a downward step somewhere in the series", () => {
    const series = metrics.mrrOverTime;
    const hasDip = series.some((d, i) => i > 0 && d.mrr < series[i - 1].mrr);
    expect(hasDip).toBe(true);
  });

  it("excludes canceled subs from current MRR", () => {
    expect(metrics.mrr).toBe(30); // only the active sub
  });
});
