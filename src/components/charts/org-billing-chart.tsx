"use client";

import { DonutChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { OrgBillingBreakdown } from "@/lib/types";

interface OrgBillingChartProps {
  data: OrgBillingBreakdown[];
  loading?: boolean;
  error?: string | null;
}

const labelMap: Record<string, string> = {
  usage_based: "Usage-Based",
  byok_user: "BYOK User",
  byok_enterprise: "BYOK Enterprise",
  internal: "Internal",
};

export function OrgBillingChart({ data, loading, error }: OrgBillingChartProps) {
  const chartData = data.map((d) => ({
    name: labelMap[d.billingType] || d.billingType,
    count: d.count,
  }));

  return (
    <ChartWrapper
      title="Org Billing Breakdown"
      description="Organizations by billing type"
      loading={loading}
      error={error}
    >
      <DonutChart
        className="h-80"
        data={chartData}
        category="count"
        index="name"
        colors={["indigo", "amber", "rose", "slate"]}
        showAnimation
        valueFormatter={(value) => `${value} orgs`}
      />
    </ChartWrapper>
  );
}
