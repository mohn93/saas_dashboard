"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyTokens } from "@/lib/types";

interface TokenUsageChartProps {
  data: DailyTokens[];
  loading?: boolean;
  error?: string | null;
}

export function TokenUsageChart({ data, loading, error }: TokenUsageChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    Tokens: d.tokens,
  }));

  return (
    <ChartWrapper
      title="Token Usage Over Time"
      description="Daily token consumption"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Tokens"]}
        colors={["indigo"]}
        yAxisWidth={64}
        showAnimation
        curveType="monotone"
        valueFormatter={(value) => value.toLocaleString()}
      />
    </ChartWrapper>
  );
}
