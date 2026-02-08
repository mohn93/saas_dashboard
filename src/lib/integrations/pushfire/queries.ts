import { getPushFireClient } from "./client";

export interface RawPlatformKPIs {
  total_users: number;
  total_projects: number;
  total_subscribers: number;
  total_devices: number;
  notifications_sent: number;
  delivery_success_rate: number;
}

export interface RawBusinessKPIs {
  mrr: number;
  paid_projects: number;
  total_projects: number;
}

export interface RawDailySubscribers {
  date: string;
  count: number;
}

export interface RawDailyNotifications {
  date: string;
  push: number;
  email: number;
}

export interface RawDailyExecutions {
  date: string;
  executions: number;
}

export interface RawDeviceBreakdown {
  os: string;
  count: number;
}

/**
 * Fetch platform KPIs (users, projects, subscribers, devices, notifications, success rate).
 */
export async function fetchPlatformKPIs(
  startDate: Date,
  endDate: Date
): Promise<RawPlatformKPIs> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_platform_kpis", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching PushFire platform KPIs:", error);
    return {
      total_users: 0,
      total_projects: 0,
      total_subscribers: 0,
      total_devices: 0,
      notifications_sent: 0,
      delivery_success_rate: 0,
    };
  }

  const row = data?.[0] as Record<string, unknown> | undefined;
  return {
    total_users: Number(row?.total_users ?? 0),
    total_projects: Number(row?.total_projects ?? 0),
    total_subscribers: Number(row?.total_subscribers ?? 0),
    total_devices: Number(row?.total_devices ?? 0),
    notifications_sent: Number(row?.notifications_sent ?? 0),
    delivery_success_rate: Number(row?.delivery_success_rate ?? 0),
  };
}

/**
 * Fetch business KPIs (MRR, paid projects).
 */
export async function fetchBusinessKPIs(): Promise<RawBusinessKPIs> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_business_kpis");

  if (error) {
    console.error("Error fetching PushFire business KPIs:", error);
    return { mrr: 0, paid_projects: 0, total_projects: 0 };
  }

  const row = data?.[0] as Record<string, unknown> | undefined;
  return {
    mrr: Number(row?.mrr ?? 0),
    paid_projects: Number(row?.paid_projects ?? 0),
    total_projects: Number(row?.total_projects ?? 0),
  };
}

/**
 * Fetch daily new subscribers.
 */
export async function fetchDailySubscribers(
  startDate: Date,
  endDate: Date
): Promise<RawDailySubscribers[]> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_daily_subscribers", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching PushFire daily subscribers:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    count: Number(row.count),
  }));
}

/**
 * Fetch daily notification counts (push + email).
 */
export async function fetchDailyNotifications(
  startDate: Date,
  endDate: Date
): Promise<RawDailyNotifications[]> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_daily_notifications", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching PushFire daily notifications:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    push: Number(row.push),
    email: Number(row.email),
  }));
}

/**
 * Fetch daily workflow executions.
 */
export async function fetchDailyExecutions(
  startDate: Date,
  endDate: Date
): Promise<RawDailyExecutions[]> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_daily_executions", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  if (error) {
    console.error("Error fetching PushFire daily executions:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    date: row.date as string,
    executions: Number(row.executions),
  }));
}

/**
 * Fetch device OS breakdown (global snapshot).
 */
export async function fetchDeviceBreakdown(): Promise<RawDeviceBreakdown[]> {
  const supabase = getPushFireClient();

  const { data, error } = await supabase.rpc("get_pushfire_device_breakdown");

  if (error) {
    console.error("Error fetching PushFire device breakdown:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    os: row.os as string,
    count: Number(row.count),
  }));
}
