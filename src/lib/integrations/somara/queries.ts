import { getSomaraClient } from "./client";

export interface RawKPIs {
  totalUsers: number;
  activeUsers: number;
  newSignups: number;
  totalMessages: number;
  totalChats: number;
  tokensUsed: number;
}

export interface RawDailyActivity {
  date: string;
  messages: number;
  active_users: number;
}

export interface RawDailySignup {
  date: string;
  count: number;
}

export interface RawDailyTokens {
  date: string;
  tokens: number;
}

export interface RawOrgBilling {
  owner_type: string;
  count: number;
}

export interface RawModelUsage {
  model_id: string;
  provider: string;
  assistant_count: number;
}

export interface RawCredits {
  source: string;
  total_granted: number;
  total_consumed: number;
  total_remaining: number;
}

export interface RawBusinessKPIs {
  active_subscribers: number;
  credits_purchased: number;
}

export interface RawDailySubscriptions {
  date: string;
  cumulative: number;
}

export interface RawDailyCreditPurchases {
  date: string;
  credits: number;
}

/**
 * Fetch all 6 KPI values for the Somara platform.
 */
export async function fetchKPIs(
  startDate: Date,
  endDate: Date
): Promise<RawKPIs> {
  const supabase = getSomaraClient();
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  const [totalUsersRes, activeUsersRes, newSignupsRes, messagesRes, chatsRes, tokensRes] =
    await Promise.all([
      // Total users (all time)
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      // Active users in period (distinct message senders)
      supabase
        .from("messages")
        .select("user_id", { count: "exact", head: true })
        .not("user_id", "is", null)
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      // New signups in period
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      // Messages in period
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      // Chats in period
      supabase
        .from("chats")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      // Tokens used in period — use RPC for SUM
      supabase.rpc("get_somara_tokens_sum", {
        start_date: startISO,
        end_date: endISO,
      }),
    ]);

  // For active users, we need distinct count, so use a different approach
  // The count above counts rows, not distinct users. Use RPC instead.
  const distinctActiveRes = await supabase.rpc("get_somara_active_users", {
    start_date: startISO,
    end_date: endISO,
  });

  return {
    totalUsers: totalUsersRes.count || 0,
    activeUsers: distinctActiveRes.data?.[0]?.count || 0,
    newSignups: newSignupsRes.count || 0,
    totalMessages: messagesRes.count || 0,
    totalChats: chatsRes.count || 0,
    tokensUsed: tokensRes.data?.[0]?.total || 0,
  };
}

/**
 * Fetch daily message counts + active users for the activity chart.
 */
export async function fetchActivityOverTime(
  startDate: Date,
  endDate: Date
): Promise<RawDailyActivity[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_daily_activity", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching Somara daily activity:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    messages: Number(row.messages),
    active_users: Number(row.active_users),
  }));
}

/**
 * Fetch daily new profile creations for the signups chart.
 */
export async function fetchSignupsOverTime(
  startDate: Date,
  endDate: Date
): Promise<RawDailySignup[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_daily_signups", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching Somara daily signups:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    count: Number(row.count),
  }));
}

/**
 * Fetch daily token consumption for the token usage chart.
 */
export async function fetchTokenUsageOverTime(
  startDate: Date,
  endDate: Date
): Promise<RawDailyTokens[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_daily_tokens", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching Somara daily tokens:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    tokens: Number(row.tokens),
  }));
}

/**
 * Fetch organization billing type breakdown (global snapshot).
 */
export async function fetchOrgBillingBreakdown(): Promise<RawOrgBilling[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_org_billing_breakdown");

  if (error) {
    console.error("Error fetching Somara org billing breakdown:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    owner_type: row.owner_type as string,
    count: Number(row.count),
  }));
}

/**
 * Fetch top 10 models by assistant count (global snapshot).
 */
export async function fetchTopModels(): Promise<RawModelUsage[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_top_models");

  if (error) {
    console.error("Error fetching Somara top models:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    model_id: row.model_id as string,
    provider: row.provider as string,
    assistant_count: Number(row.assistant_count),
  }));
}

/**
 * Fetch credits overview grouped by source (global snapshot).
 */
export async function fetchCreditsOverview(): Promise<RawCredits[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_credits_overview");

  if (error) {
    console.error("Error fetching Somara credits overview:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    source: row.source as string,
    total_granted: Number(row.total_granted),
    total_consumed: Number(row.total_consumed),
    total_remaining: Number(row.total_remaining),
  }));
}

/**
 * Fetch business KPIs: active subscribers + total credits purchased.
 */
export async function fetchBusinessKPIs(): Promise<RawBusinessKPIs> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_business_kpis");

  if (error) {
    console.error("Error fetching Somara business KPIs:", error);
    return { active_subscribers: 0, credits_purchased: 0 };
  }

  const row = data?.[0] as Record<string, unknown> | undefined;
  return {
    active_subscribers: Number(row?.active_subscribers ?? 0),
    credits_purchased: Number(row?.credits_purchased ?? 0),
  };
}

/**
 * Fetch cumulative active subscriptions per day.
 */
export async function fetchSubscriptionsOverTime(
  startDate: Date,
  endDate: Date
): Promise<RawDailySubscriptions[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_subscriptions_over_time", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching Somara subscriptions over time:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    cumulative: Number(row.cumulative),
  }));
}

/**
 * Fetch daily credit purchase volumes.
 */
export async function fetchCreditPurchasesOverTime(
  startDate: Date,
  endDate: Date
): Promise<RawDailyCreditPurchases[]> {
  const supabase = getSomaraClient();

  const { data, error } = await supabase.rpc("get_somara_credit_purchases_over_time", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching Somara credit purchases over time:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    credits: Number(row.credits),
  }));
}
