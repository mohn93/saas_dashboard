"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyActivity } from "@/lib/types";

interface ActivityChartProps {
  data: DailyActivity[];
  loading?: boolean;
  error?: string | null;
}

export function ActivityChart({ data, loading, error }: ActivityChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    Messages: d.messages,
    "Active Users": d.activeUsers,
  }));

  return (
    <ChartWrapper
      title="Activity Over Time"
      description="Daily messages and active users"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Messages", "Active Users"]}
        colors={["indigo", "violet"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
