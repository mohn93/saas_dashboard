"use client";

import { DonutChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { ULinkClientHealth } from "@/lib/types";

interface HealthStatusChartProps {
  health: ULinkClientHealth;
  loading?: boolean;
  error?: string | null;
}

export function HealthStatusChart({
  health,
  loading,
  error,
}: HealthStatusChartProps) {
  const chartData = [
    { name: "Healthy", count: health.healthyCount },
    { name: "At Risk", count: health.atRiskCount },
    { name: "Inactive", count: health.inactiveCount },
  ].filter((d) => d.count > 0);

  return (
    <ChartWrapper
      title="Health Distribution"
      description="Project health breakdown"
      loading={loading}
      error={error}
    >
      <DonutChart
        className="h-80"
        data={chartData}
        category="count"
        index="name"
        colors={["emerald", "amber", "rose"]}
        showAnimation
      />
    </ChartWrapper>
  );
}
