"use client";

import { BarChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { CountryBreakdown as CountryBreakdownType } from "@/lib/types";

interface CountryBreakdownProps {
  data: CountryBreakdownType[];
  loading?: boolean;
  error?: string | null;
}

export function CountryBreakdown({
  data,
  loading,
  error,
}: CountryBreakdownProps) {
  const chartData = data.map((d) => ({
    country: d.country,
    Users: d.users,
  }));

  return (
    <ChartWrapper
      title="Countries"
      description="Users by country"
      loading={loading}
      error={error}
    >
      <BarChart
        className="h-80"
        data={chartData}
        index="country"
        categories={["Users"]}
        colors={["cyan"]}
        layout="vertical"
        yAxisWidth={100}
        showAnimation
      />
    </ChartWrapper>
  );
}
