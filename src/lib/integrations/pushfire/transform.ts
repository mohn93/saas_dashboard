import { addDays, format } from "date-fns";
import type {
  PushFireMetrics,
  PushFireKPIs,
  PushFireBusinessKPIs,
  DailyNewSubscribers,
  DailyNotifications,
  DailyExecutions,
  DeviceOSBreakdown,
} from "@/lib/types";
import type {
  RawPlatformKPIs,
  RawBusinessKPIs,
  RawDailySubscribers,
  RawDailyNotifications,
  RawDailyExecutions,
  RawDeviceBreakdown,
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

function transformPlatformKPIs(raw: RawPlatformKPIs): PushFireKPIs {
  return {
    totalUsers: raw.total_users,
    totalProjects: raw.total_projects,
    totalSubscribers: raw.total_subscribers,
    totalDevices: raw.total_devices,
    notificationsSent: raw.notifications_sent,
    deliverySuccessRate: raw.delivery_success_rate,
  };
}

function transformBusinessKPIs(raw: RawBusinessKPIs): PushFireBusinessKPIs {
  return {
    mrr: raw.mrr,
    paidProjects: raw.paid_projects,
    signupToPaidRate: raw.total_projects > 0 ? raw.paid_projects / raw.total_projects : 0,
  };
}

function fillSubscribersOverTime(
  sparse: RawDailySubscribers[],
  allDates: string[]
): DailyNewSubscribers[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.count]));
  return allDates.map((date) => ({
    date,
    count: byDate.get(date) || 0,
  }));
}

function fillNotificationsOverTime(
  sparse: RawDailyNotifications[],
  allDates: string[]
): DailyNotifications[] {
  const byDate = new Map(sparse.map((r) => [r.date, { push: r.push, email: r.email }]));
  return allDates.map((date) => ({
    date,
    push: byDate.get(date)?.push || 0,
    email: byDate.get(date)?.email || 0,
  }));
}

function fillExecutionsOverTime(
  sparse: RawDailyExecutions[],
  allDates: string[]
): DailyExecutions[] {
  const byDate = new Map(sparse.map((r) => [r.date, r.executions]));
  return allDates.map((date) => ({
    date,
    executions: byDate.get(date) || 0,
  }));
}

function transformDeviceBreakdown(raw: RawDeviceBreakdown[]): DeviceOSBreakdown[] {
  return raw.map((r) => ({
    os: r.os,
    count: r.count,
  }));
}

export function transformPushFireMetrics(params: {
  platformKpis: RawPlatformKPIs;
  businessKpis: RawBusinessKPIs;
  dailySubscribers: RawDailySubscribers[];
  dailyNotifications: RawDailyNotifications[];
  dailyExecutions: RawDailyExecutions[];
  deviceBreakdown: RawDeviceBreakdown[];
  startDate: Date;
  endDate: Date;
}): PushFireMetrics {
  const allDates = generateDateRange(params.startDate, params.endDate);

  return {
    kpis: transformPlatformKPIs(params.platformKpis),
    businessKpis: transformBusinessKPIs(params.businessKpis),
    subscribersOverTime: fillSubscribersOverTime(params.dailySubscribers, allDates),
    notificationsOverTime: fillNotificationsOverTime(params.dailyNotifications, allDates),
    executionsOverTime: fillExecutionsOverTime(params.dailyExecutions, allDates),
    deviceBreakdown: transformDeviceBreakdown(params.deviceBreakdown),
  };
}
