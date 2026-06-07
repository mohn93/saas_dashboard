"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyVisitors, DailySignups } from "@/lib/types";
import { format, parse } from "date-fns";

interface VisitorsLineChartProps {
  data: DailyVisitors[];
  loading?: boolean;
  error?: string | null;
  dashboardMode?: boolean;
  /**
   * Daily new signups from the DB (DailySignups.date is "YYYY-MM-DD"). When
   * provided in dashboardMode, adds a "New Users (signups)" line — real new
   * customers, as opposed to the GA "Users" line (anonymous dashboard sessions).
   */
  signups?: DailySignups[];
}

export function VisitorsLineChart({
  data,
  loading,
  error,
  dashboardMode,
  signups,
}: VisitorsLineChartProps) {
  if (dashboardMode) {
    // Merge DB signups onto the GA daily series. GA dates are "YYYYMMDD";
    // signups are "YYYY-MM-DD" — normalize GA to dashed ISO for the lookup.
    const signupsByDate = new Map((signups ?? []).map((s) => [s.date, s.signups]));
    const hasSignups = signupsByDate.size > 0;

    const chartData = data.map((d) => {
      const iso = `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;
      const point: Record<string, string | number> = {
        date: format(parse(d.date, "yyyyMMdd", new Date()), "MMM dd"),
        Users: d.activeUsers,
        Sessions: d.sessions,
      };
      if (hasSignups) point["New Users (signups)"] = signupsByDate.get(iso) ?? 0;
      return point;
    });

    const categories = hasSignups
      ? ["Users", "New Users (signups)", "Sessions"]
      : ["Users", "Sessions"];
    const colors = hasSignups ? ["violet", "emerald", "blue"] : ["violet", "blue"];

    return (
      <ChartWrapper
        title="Dashboard Users Over Time"
        description={
          hasSignups
            ? "Daily dashboard users, new signups, and sessions"
            : "Daily unique users and sessions on dashboard pages"
        }
        loading={loading}
        error={error}
      >
        <AreaChart
          className="h-80"
          data={chartData}
          index="date"
          categories={categories}
          colors={colors}
          yAxisWidth={48}
          showAnimation
          curveType="monotone"
          connectNulls
        />
      </ChartWrapper>
    );
  }

  const chartData = data.map((d) => ({
    date: format(parse(d.date, "yyyyMMdd", new Date()), "MMM dd"),
    "Active Visitors": d.activeUsers,
    "New Visitors": d.newUsers,
    Sessions: d.sessions,
  }));

  return (
    <ChartWrapper
      title="Visitors Over Time"
      description="Daily active visitors, new visitors, and sessions"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Active Visitors", "New Visitors", "Sessions"]}
        colors={["violet", "emerald", "blue"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
        connectNulls
      />
    </ChartWrapper>
  );
}
