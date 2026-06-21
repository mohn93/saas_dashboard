import { addDays, differenceInDays, format, parseISO } from "date-fns";
import type {
  ULinkBusinessMetrics,
  DailySignups,
  DailyMRR,
} from "@/lib/types";
import type { RawSignupRow, RawSubscriptionRow } from "./queries";

/**
 * Determine if a subscription is on a yearly billing interval
 * by checking the length of the current billing period.
 */
function isYearlySubscription(sub: RawSubscriptionRow): boolean {
  if (!sub.current_period_start || !sub.current_period_end) return false;
  const days = differenceInDays(
    parseISO(sub.current_period_end),
    parseISO(sub.current_period_start)
  );
  return days > 60;
}

/**
 * Get the monthly rate for a subscription, accounting for billing interval.
 */
function getMonthlyRate(sub: RawSubscriptionRow): number {
  if (isYearlySubscription(sub) && sub.price_yearly != null) {
    return sub.price_yearly / 12;
  }
  return sub.price_monthly || 0;
}

/** Statuses that count toward live MRR (a subscription that is paying now). */
const ACTIVE_MRR_STATUSES = new Set(["active", "trialing"]);

/**
 * The day a subscription stops contributing to MRR, or null if it is still live.
 *
 * Only canceled subscriptions have an end date. Active/trialing subs are
 * open-ended — their current_period_end is just the next renewal, not an end.
 * Per product decision, MRR drops on canceled_at; for legacy canceled rows that
 * predate canceled_at being recorded, fall back to current_period_end.
 */
function mrrEndDate(sub: RawSubscriptionRow): string | null {
  if (sub.status !== "canceled") return null;
  const end = sub.canceled_at ?? sub.current_period_end;
  return end ? format(parseISO(end), "yyyy-MM-dd") : null;
}

/**
 * Calculate current MRR from subscriptions that are paying now (active/trialing).
 * Canceled rows may be present in the input (for the time series) but must not
 * count toward the live number.
 */
function calculateMRR(subscriptions: RawSubscriptionRow[]): number {
  return subscriptions
    .filter((sub) => ACTIVE_MRR_STATUSES.has(sub.status))
    .reduce((sum, sub) => sum + getMonthlyRate(sub), 0);
}

/**
 * Compute MRR for each day in the range.
 * A subscription contributes from its created_at date until its end date
 * (the cancellation day for canceled subs), so cancellations show up as dips.
 */
function computeMRROverTime(
  subscriptions: RawSubscriptionRow[],
  allDates: string[]
): DailyMRR[] {
  return allDates.map((date) => {
    const mrr = subscriptions.reduce((sum, sub) => {
      const activatedOn = format(parseISO(sub.created_at), "yyyy-MM-dd");
      if (activatedOn > date) return sum; // not created yet

      const endOn = mrrEndDate(sub);
      if (endOn !== null && date >= endOn) return sum; // already canceled by this day

      return sum + getMonthlyRate(sub);
    }, 0);
    return { date, mrr };
  });
}

/**
 * Generate every date string (YYYY-MM-DD) between start and end inclusive.
 */
function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(format(current, "yyyy-MM-dd"));
    current = addDays(current, 1);
  }
  return dates;
}


/**
 * Fill in all days for signups, with 0 for days with no signups.
 */
function fillSignupsOverTime(
  sparse: RawSignupRow[],
  allDates: string[]
): DailySignups[] {
  const signupsByDate = new Map(sparse.map((r) => [r.date, r.count]));

  return allDates.map((date) => ({
    date,
    signups: signupsByDate.get(date) || 0,
  }));
}

import type {
  ULinkClientHealth,
  ProjectHealthSummary,
  OnboardingSteps,
} from "@/lib/types";
import type { RawProjectHealth } from "./queries";

/**
 * Compute health score for a project:
 * - healthy: has links AND recent clicks AND onboarding >= 4 steps
 * - at-risk: has links OR onboarding >= 2 steps, but missing some healthy criteria
 * - inactive: no links AND onboarding < 2 steps
 */
function computeHealthScore(
  linksCreated: number,
  recentClicks: number,
  onboardingProgress: number
): "healthy" | "at-risk" | "inactive" {
  const hasLinks = linksCreated > 0;
  const hasRecentClicks = recentClicks > 0;
  const goodOnboarding = onboardingProgress >= 4;

  if (hasLinks && hasRecentClicks && goodOnboarding) {
    return "healthy";
  }
  if (hasLinks || onboardingProgress >= 2) {
    return "at-risk";
  }
  return "inactive";
}

function toOnboardingSteps(raw: RawProjectHealth): OnboardingSteps {
  return {
    domainSetup: raw.domain_setup,
    platformSelection: raw.platform_selection,
    platformConfig: raw.platform_config,
    cliVerified: raw.cli_verified,
    sdkSetupViewed: raw.sdk_setup_viewed,
    platformImplementationViewed: raw.platform_implementation_viewed,
  };
}

function countOnboardingProgress(steps: OnboardingSteps): number {
  return [
    steps.domainSetup,
    steps.platformSelection,
    steps.platformConfig,
    steps.cliVerified,
    steps.sdkSetupViewed,
    steps.platformImplementationViewed,
  ].filter(Boolean).length;
}

const healthOrder: Record<string, number> = {
  healthy: 0,
  "at-risk": 1,
  inactive: 2,
};

export function transformClientHealth(
  raw: RawProjectHealth[]
): ULinkClientHealth {
  const projects: ProjectHealthSummary[] = raw.map((r) => {
    const onboardingSteps = toOnboardingSteps(r);
    const onboardingProgress = countOnboardingProgress(onboardingSteps);
    const healthScore = computeHealthScore(
      r.links_created,
      r.recent_clicks,
      onboardingProgress
    );

    return {
      projectId: r.project_id,
      projectName: r.project_name,
      createdAt: r.project_created_at,
      memberCount: r.member_count,
      onboardingSteps,
      onboardingProgress,
      isConfigured: r.is_configured,
      linksCreated: r.links_created,
      totalClicks: r.total_clicks,
      recentClicks: r.recent_clicks,
      healthScore,
    };
  });

  // Sort: inactive first, then at-risk, then healthy
  projects.sort(
    (a, b) => healthOrder[a.healthScore] - healthOrder[b.healthScore]
  );

  const healthyCount = projects.filter((p) => p.healthScore === "healthy").length;
  const atRiskCount = projects.filter((p) => p.healthScore === "at-risk").length;
  const inactiveCount = projects.filter((p) => p.healthScore === "inactive").length;

  const totalOnboarding = projects.reduce(
    (sum, p) => sum + p.onboardingProgress,
    0
  );
  const configuredCount = projects.filter((p) => p.isConfigured).length;
  const projectsWithLinks = projects.filter((p) => p.linksCreated > 0).length;

  return {
    totalProjects: projects.length,
    healthyCount,
    atRiskCount,
    inactiveCount,
    avgOnboardingProgress:
      projects.length > 0 ? totalOnboarding / (projects.length * 6) : 0,
    configuredRate:
      projects.length > 0 ? configuredCount / projects.length : 0,
    projectsWithLinks,
    projects,
  };
}

export function transformBusinessMetrics(params: {
  signupsDaily: RawSignupRow[];
  totalSignups: number;
  subscriptions: RawSubscriptionRow[];
  totalPaidUsers: number;
  paidInCohort: number;
  activeProjects: number;
  gaVisitors: number;
  startDate: Date;
  endDate: Date;
}): ULinkBusinessMetrics {
  const mrr = calculateMRR(params.subscriptions);
  const allDates = generateDateRange(params.startDate, params.endDate);

  const signupsOverTime = fillSignupsOverTime(params.signupsDaily, allDates);
  const mrrOverTime = computeMRROverTime(params.subscriptions, allDates);

  const visitorToSignupRate =
    params.gaVisitors > 0 ? params.totalSignups / params.gaVisitors : 0;
  // Cohort conversion: of users who signed up in the period, how many are paying.
  // Recent cohorts skew low because they haven't had time to convert.
  const signupToPaidRate =
    params.totalSignups > 0 ? params.paidInCohort / params.totalSignups : 0;

  return {
    mrr,
    totalSignups: params.totalSignups,
    totalPaidUsers: params.totalPaidUsers,
    activeProjects: params.activeProjects,
    visitorToSignupRate,
    signupToPaidRate,
    signupsOverTime,
    mrrOverTime,
  };
}
