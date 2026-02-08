"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyMRR } from "@/lib/types";

interface MRRChartProps {
  data: DailyMRR[];
  loading?: boolean;
  error?: string | null;
}

export function MRRChart({ data, loading, error }: MRRChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    MRR: d.mrr,
  }));

  return (
    <ChartWrapper
      title="MRR Over Time"
      description="Monthly recurring revenue trend"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["MRR"]}
        colors={["emerald"]}
        yAxisWidth={64}
        showAnimation
        curveType="monotone"
        valueFormatter={(value) =>
          `$${value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`
        }
      />
    </ChartWrapper>
  );
}
