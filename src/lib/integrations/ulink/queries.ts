import { getULinkClient } from "./client";

export interface RawSignupRow {
  date: string;
  count: number;
}

export interface RawSubscriptionRow {
  id: string;
  status: string;
  price_monthly: number | null;
  price_yearly: number | null;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
}

/**
 * Fetch signups from auth.users within the date range, grouped by day.
 */
export async function fetchSignups(
  startDate: Date,
  endDate: Date
): Promise<{ daily: RawSignupRow[]; total: number }> {
  const supabase = getULinkClient();

  // Get total count in date range
  const { count, error: countError } = await supabase
    .from("users_view")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (countError) {
    console.error("Error fetching signup count:", countError);
  }

  // Get daily signups using the users_view (a view on auth.users)
  const { data, error } = await supabase
    .rpc("get_daily_signups", {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    });

  if (error) {
    console.error("Error fetching daily signups:", error);
    return { daily: [], total: count || 0 };
  }

  const daily = (data || []).map((row: { date: string; count: number }) => ({
    date: row.date,
    count: Number(row.count),
  }));

  return { daily, total: count || 0 };
}

/**
 * Fetch active/trialing subscriptions with their plan pricing.
 */
export async function fetchActiveSubscriptions(): Promise<{
  subscriptions: RawSubscriptionRow[];
  totalPaidUsers: number;
}> {
  const supabase = getULinkClient();

  const { data, error, count } = await supabase
    .from("subscriptions")
    .select(
      "id, status, current_period_start, current_period_end, subscription_plans(price_monthly, price_yearly), created_at",
      { count: "exact" }
    )
    .in("status", ["active", "trialing"])
    .eq("environment", "production");

  if (error) {
    console.error("Error fetching subscriptions:", error);
    return { subscriptions: [], totalPaidUsers: 0 };
  }

  const subscriptions: RawSubscriptionRow[] = (data || []).map((row: Record<string, unknown>) => {
    const plan = row.subscription_plans as Record<string, unknown> | null;
    return {
      id: row.id as string,
      status: row.status as string,
      price_monthly: plan?.price_monthly as number | null,
      price_yearly: plan?.price_yearly as number | null,
      current_period_start: row.current_period_start as string,
      current_period_end: row.current_period_end as string,
      created_at: row.created_at as string,
    };
  });

  return { subscriptions, totalPaidUsers: count || 0 };
}

/**
 * Fetch MRR trend over time by looking at subscription activation dates.
 */
export async function fetchMRROverTime(
  startDate: Date,
  endDate: Date
): Promise<{ date: string; mrr: number }[]> {
  const supabase = getULinkClient();

  const { data, error } = await supabase
    .rpc("get_mrr_over_time", {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    });

  if (error) {
    console.error("Error fetching MRR over time:", error);
    return [];
  }

  return (data || []).map((row: { date: string; mrr: number }) => ({
    date: row.date,
    mrr: Number(row.mrr),
  }));
}

/**
 * Count distinct projects with activity (link created, link clicked, or SDK session)
 * within the date range.
 */
export async function fetchActiveProjects(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const supabase = getULinkClient();
  const start = startDate.toISOString();
  const end = endDate.toISOString();

  // Projects that created links in the period
  const { data: linkProjects } = await supabase
    .from("links")
    .select("project_id")
    .gte("created_at", start)
    .lte("created_at", end);

  // Projects with SDK sessions in the period
  const { data: sessionProjects } = await supabase
    .from("user_sessions")
    .select("project_id")
    .gte("session_start", start)
    .lte("session_start", end);

  // Combine distinct project IDs
  const projectIds = new Set<string>();
  for (const row of linkProjects || []) {
    projectIds.add(row.project_id);
  }
  for (const row of sessionProjects || []) {
    projectIds.add(row.project_id);
  }

  return projectIds.size;
}

// Phase 3: Client Health

export interface RawProjectHealth {
  project_id: string;
  project_name: string;
  project_created_at: string;
  member_count: number;
  domain_setup: boolean;
  platform_selection: boolean;
  platform_config: boolean;
  cli_verified: boolean;
  sdk_setup_viewed: boolean;
  platform_implementation_viewed: boolean;
  is_configured: boolean;
  links_created: number;
  total_clicks: number;
  recent_clicks: number;
}

/**
 * Fetch per-project health summary from ULink database.
 * Uses the get_project_health_summary RPC for a single round-trip.
 */
export async function fetchProjectHealth(
  startDate: Date,
  endDate: Date
): Promise<RawProjectHealth[]> {
  const supabase = getULinkClient();

  const { data, error } = await supabase.rpc("get_project_health_summary", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching project health:", error);
    throw new Error(`Failed to fetch project health: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    project_id: row.project_id as string,
    project_name: row.project_name as string,
    project_created_at: row.project_created_at as string,
    member_count: Number(row.member_count),
    domain_setup: Boolean(row.domain_setup),
    platform_selection: Boolean(row.platform_selection),
    platform_config: Boolean(row.platform_config),
    cli_verified: Boolean(row.cli_verified),
    sdk_setup_viewed: Boolean(row.sdk_setup_viewed),
    platform_implementation_viewed: Boolean(row.platform_implementation_viewed),
    is_configured: Boolean(row.is_configured),
    links_created: Number(row.links_created),
    total_clicks: Number(row.total_clicks),
    recent_clicks: Number(row.recent_clicks),
  }));
}
