"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyExecutions } from "@/lib/types";

interface ExecutionsChartProps {
  data: DailyExecutions[];
  loading?: boolean;
  error?: string | null;
}

export function ExecutionsChart({ data, loading, error }: ExecutionsChartProps) {
  const chartData = data.map((d) => ({
    date: d.date,
    Executions: d.executions,
  }));

  return (
    <ChartWrapper
      title="Workflow Executions"
      description="Daily workflow execution count"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={["Executions"]}
        colors={["orange"]}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
      />
    </ChartWrapper>
  );
}
