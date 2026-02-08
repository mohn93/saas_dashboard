"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyNotifications } from "@/lib/types";

interface NotificationsChartProps {
  data: DailyNotifications[];
  loading?: boolean;
  error?: string | null;
}

export function NotificationsChart({ data, loading, error }: NotificationsChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    Push: d.push,
    Email: d.email,
  }));

  return (
    <ChartWrapper
      title="Notifications Over Time"
      description="Daily push and email notifications sent"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Push", "Email"]}
        colors={["red", "amber"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
