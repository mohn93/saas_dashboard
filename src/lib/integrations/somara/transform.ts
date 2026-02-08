import { addDays, format } from "date-fns";
import type {
  SomaraMetrics,
  SomaraKPIs,
  SomaraBusinessKPIs,
  DailyActivity,
  DailySignups,
  DailyTokens,
  DailySubscriptions,
  DailyCreditPurchases,
  OrgBillingBreakdown,
  ModelUsage,
  CreditsOverview,
} from "@/lib/types";
import type {
  RawKPIs,
  RawDailyActivity,
  RawDailySignup,
  RawDailyTokens,
  RawOrgBilling,
  RawModelUsage,
  RawCredits,
  RawBusinessKPIs,
  RawDailySubscriptions,
  RawDailyCreditPurchases,
} from "./queries";

function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(format(current, "yyyy-MM-dd"));
    current = addDays(current, 1);
  }
  return dates;
}

function fillActivityOverTime(
  sparse: RawDailyActivity[],
  allDates: string[]
): DailyActivity[] {
  const byDate = new Map(
    sparse.map((r) => [r.date, { messages: r.messages, activeUsers: r.active_users }])
  );

  return allDates.map((date) => ({
    date,
    messages: byDate.get(date)?.messages || 0,
    activeUsers: byDate.get(date)?.activeUsers || 0,
  }));
}

function fillSignupsOverTime(
  sparse: RawDailySignup[],
  allDates: string[]
): DailySignups[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.count]));

  return allDates.map((date) => ({
    date,
    signups: byDate.get(date) || 0,
  }));
}

function fillTokensOverTime(
  sparse: RawDailyTokens[],
  allDates: string[]
): DailyTokens[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.tokens]));

  return allDates.map((date) => ({
    date,
    tokens: byDate.get(date) || 0,
  }));
}

function transformOrgBilling(raw: RawOrgBilling[]): OrgBillingBreakdown[] {
  return raw.map((r) => ({
    billingType: r.owner_type,
    count: r.count,
  }));
}

function transformModels(raw: RawModelUsage[]): ModelUsage[] {
  return raw.map((r) => ({
    modelId: r.model_id,
    provider: r.provider,
    assistantCount: r.assistant_count,
  }));
}

function transformCredits(raw: RawCredits[]): CreditsOverview[] {
  return raw.map((r) => ({
    source: r.source,
    totalGranted: r.total_granted,
    totalConsumed: r.total_consumed,
    totalRemaining: r.total_remaining,
  }));
}

function transformBusinessKPIs(
  raw: RawBusinessKPIs,
  totalUsers: number
): SomaraBusinessKPIs {
  return {
    activeSubscribers: raw.active_subscribers,
    creditsPurchased: raw.credits_purchased,
    signupToPaidRate: totalUsers > 0 ? raw.active_subscribers / totalUsers : 0,
  };
}

function fillSubscriptionsOverTime(
  sparse: RawDailySubscriptions[],
  allDates: string[]
): DailySubscriptions[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.cumulative]));

  // For cumulative data, carry forward the last known value
  let lastValue = 0;
  return allDates.map((date) => {
    const value = byDate.get(date);
    if (value !== undefined) {
      lastValue = value;
    }
    return { date, cumulative: lastValue };
  });
}

function fillCreditPurchasesOverTime(
  sparse: RawDailyCreditPurchases[],
  allDates: string[]
): DailyCreditPurchases[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.credits]));

  return allDates.map((date) => ({
    date,
    credits: byDate.get(date) || 0,
  }));
}

export function transformSomaraMetrics(params: {
  kpis: RawKPIs;
  activityOverTime: RawDailyActivity[];
  signupsOverTime: RawDailySignup[];
  tokenUsageOverTime: RawDailyTokens[];
  orgBillingBreakdown: RawOrgBilling[];
  topModels: RawModelUsage[];
  creditsOverview: RawCredits[];
  businessKpis: RawBusinessKPIs;
  subscriptionsOverTime: RawDailySubscriptions[];
  creditPurchasesOverTime: RawDailyCreditPurchases[];
  startDate: Date;
  endDate: Date;
}): SomaraMetrics {
  const allDates = generateDateRange(params.startDate, params.endDate);

  return {
    kpis: params.kpis,
    activityOverTime: fillActivityOverTime(params.activityOverTime, allDates),
    signupsOverTime: fillSignupsOverTime(params.signupsOverTime, allDates),
    tokenUsageOverTime: fillTokensOverTime(params.tokenUsageOverTime, allDates),
    orgBillingBreakdown: transformOrgBilling(params.orgBillingBreakdown),
    topModels: transformModels(params.topModels),
    creditsOverview: transformCredits(params.creditsOverview),
    businessKpis: transformBusinessKPIs(params.businessKpis, params.kpis.totalUsers),
    subscriptionsOverTime: fillSubscriptionsOverTime(params.subscriptionsOverTime, allDates),
    creditPurchasesOverTime: fillCreditPurchasesOverTime(params.creditPurchasesOverTime, allDates),
  };
}
