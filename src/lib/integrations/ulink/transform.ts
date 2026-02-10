import { addDays, format } from "date-fns";
import type {
  ULinkBusinessMetrics,
  DailySignups,
  DailyMRR,
} from "@/lib/types";
import type { RawSignupRow, RawSubscriptionRow } from "./queries";

/**
 * Calculate MRR from active subscriptions.
 * Always use price_monthly (the plan's monthly rate) regardless of
 * billing interval — MRR reflects recurring value at list rate.
 */
function calculateMRR(subscriptions: RawSubscriptionRow[]): number {
  return subscriptions.reduce((sum, sub) => {
    return sum + (sub.price_monthly || 0);
  }, 0);
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
 * Fill in all days for MRR, forward-filling the last known value.
 */
function fillMRROverTime(
  sparse: { date: string; mrr: number }[],
  allDates: string[]
): DailyMRR[] {
  const mrrByDate = new Map(sparse.map((r) => [r.date, r.mrr]));
  let lastMRR = 0;

  return allDates.map((date) => {
    if (mrrByDate.has(date)) {
      lastMRR = mrrByDate.get(date)!;
    }
    return { date, mrr: lastMRR };
  });
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
  activeProjects: number;
  mrrOverTime: { date: string; mrr: number }[];
  gaVisitors: number;
  startDate: Date;
  endDate: Date;
}): ULinkBusinessMetrics {
  const mrr = calculateMRR(params.subscriptions);
  const allDates = generateDateRange(params.startDate, params.endDate);

  const signupsOverTime = fillSignupsOverTime(params.signupsDaily, allDates);
  const mrrOverTime = fillMRROverTime(params.mrrOverTime, allDates);

  const visitorToSignupRate =
    params.gaVisitors > 0 ? params.totalSignups / params.gaVisitors : 0;
  const signupToPaidRate =
    params.totalSignups > 0 ? params.totalPaidUsers / params.totalSignups : 0;

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
