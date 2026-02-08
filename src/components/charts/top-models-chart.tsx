"use client";

import { BarList } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { ModelUsage } from "@/lib/types";

interface TopModelsChartProps {
  data: ModelUsage[];
  loading?: boolean;
  error?: string | null;
}

export function TopModelsChart({ data, loading, error }: TopModelsChartProps) {
  const chartData = data.map((d) => ({
    name: d.modelId,
    value: d.assistantCount,
  }));

  return (
    <ChartWrapper
      title="Top Models"
      description="Most popular models by assistant count"
      loading={loading}
      error={error}
    >
      <BarList data={chartData} className="h-80" color="indigo" showAnimation />
    </ChartWrapper>
  );
}
