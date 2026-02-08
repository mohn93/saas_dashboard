"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailySubscriptions } from "@/lib/types";

interface SubscriptionsChartProps {
  data: DailySubscriptions[];
  loading?: boolean;
  error?: string | null;
}

export function SubscriptionsChart({ data, loading, error }: SubscriptionsChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    "Active Subscriptions": d.cumulative,
  }));

  return (
    <ChartWrapper
      title="Subscriptions Over Time"
      description="Cumulative active subscriptions by day"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Active Subscriptions"]}
        colors={["indigo"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
