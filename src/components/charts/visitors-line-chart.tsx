"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyVisitors } from "@/lib/types";
import { format, parse } from "date-fns";

interface VisitorsLineChartProps {
  data: DailyVisitors[];
  loading?: boolean;
  error?: string | null;
}

export function VisitorsLineChart({
  data,
  loading,
  error,
}: VisitorsLineChartProps) {
  const chartData = data.map((d) => ({
    date: format(parse(d.date, "yyyyMMdd", new Date()), "MMM dd"),
    "Active Users": d.activeUsers,
    "New Users": d.newUsers,
    Sessions: d.sessions,
  }));

  return (
    <ChartWrapper
      title="Visitors Over Time"
      description="Daily active users, new users, and sessions"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Active Users", "New Users", "Sessions"]}
        colors={["violet", "emerald", "blue"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
        connectNulls
      />
    </ChartWrapper>
  );
}
