"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailySignups } from "@/lib/types";

interface SignupsChartProps {
  data: DailySignups[];
  loading?: boolean;
  error?: string | null;
}

export function SignupsChart({ data, loading, error }: SignupsChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    Signups: d.signups,
  }));

  return (
    <ChartWrapper
      title="Signups Over Time"
      description="Daily new user registrations"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Signups"]}
        colors={["blue"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
