"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyNewSubscribers } from "@/lib/types";

interface SubscribersOverTimeChartProps {
  data: DailyNewSubscribers[];
  loading?: boolean;
  error?: string | null;
}

export function SubscribersOverTimeChart({ data, loading, error }: SubscribersOverTimeChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    "New Subscribers": d.count,
  }));

  return (
    <ChartWrapper
      title="Subscribers Over Time"
      description="Daily new subscriber registrations"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["New Subscribers"]}
        colors={["rose"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
