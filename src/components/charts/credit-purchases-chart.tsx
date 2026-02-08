"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyCreditPurchases } from "@/lib/types";

interface CreditPurchasesChartProps {
  data: DailyCreditPurchases[];
  loading?: boolean;
  error?: string | null;
}

export function CreditPurchasesChart({ data, loading, error }: CreditPurchasesChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    "Credits Purchased": d.credits,
  }));

  return (
    <ChartWrapper
      title="Credit Purchases Over Time"
      description="Daily credit purchase volume"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Credits Purchased"]}
        colors={["emerald"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
        valueFormatter={(value) => value.toLocaleString()}
      />
    </ChartWrapper>
  );
}
