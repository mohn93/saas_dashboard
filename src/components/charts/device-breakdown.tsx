"use client";

import { DonutChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DeviceBreakdown as DeviceBreakdownType } from "@/lib/types";

interface DeviceBreakdownProps {
  data: DeviceBreakdownType[];
  loading?: boolean;
  error?: string | null;
}

export function DeviceBreakdown({
  data,
  loading,
  error,
}: DeviceBreakdownProps) {
  const chartData = data.map((d) => ({
    name: d.deviceCategory.charAt(0).toUpperCase() + d.deviceCategory.slice(1),
    users: d.users,
  }));

  return (
    <ChartWrapper
      title="Devices"
      description="Users by device type"
      loading={loading}
      error={error}
    >
      <DonutChart
        className="h-80"
        data={chartData}
        category="users"
        index="name"
        colors={["violet", "amber", "rose", "emerald"]}
        showAnimation
        variant="pie"
      />
    </ChartWrapper>
  );
}
