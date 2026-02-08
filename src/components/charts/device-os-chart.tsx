"use client";

import { DonutChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DeviceOSBreakdown } from "@/lib/types";

interface DeviceOSChartProps {
  data: DeviceOSBreakdown[];
  loading?: boolean;
  error?: string | null;
}

const osLabels: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  desktop: "Desktop",
  other: "Other",
};

export function DeviceOSChart({ data, loading, error }: DeviceOSChartProps) {
  const chartData = data.map((d) => ({
    os: osLabels[d.os] || d.os,
    devices: d.count,
  }));

  return (
    <ChartWrapper
      title="Device OS Breakdown"
      description="Registered devices by operating system"
      loading={loading}
      error={error}
    >
      <DonutChart
        className="h-80"
        data={chartData}
        index="os"
        category="devices"
        colors={["rose", "emerald", "blue", "amber", "slate"]}
        showAnimation
        variant="pie"
      />
    </ChartWrapper>
  );
}
