"use client";

import { AreaChart } from "@tremor/react";
import { ChartWrapper } from "./chart-wrapper";
import type { DailyVisitors } from "@/lib/types";
import type { ProductConfig } from "@/lib/types";
import { format, parse } from "date-fns";

interface MultiProductChartProps {
  data: Record<string, DailyVisitors[]>;
  products: ProductConfig[];
  loading?: boolean;
  error?: string | null;
}

export function MultiProductChart({
  data,
  products,
  loading,
  error,
}: MultiProductChartProps) {
  // Merge all products' daily data into a single series keyed by date
  const dateMap = new Map<string, Record<string, number>>();

  for (const product of products) {
    const visitors = data[product.slug] || [];
    for (const d of visitors) {
      const existing = dateMap.get(d.date) || {};
      existing[product.name] = d.activeUsers;
      dateMap.set(d.date, existing);
    }
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date: format(parse(date, "yyyyMMdd", new Date()), "MMM dd"),
      ...values,
    }));

  const categories = products.map((p) => p.name);
  // Vibrant colors that pop on dark backgrounds
  const colors = ["violet", "amber", "rose"];

  return (
    <ChartWrapper
      title="Visitors Across Products"
      description="Daily active users per product"
      loading={loading}
      error={error}
    >
      <AreaChart
        className="h-80"
        data={chartData}
        index="date"
        categories={categories}
        colors={colors}
        yAxisWidth={48}
        showAnimation
        curveType="monotone"
        connectNulls
      />
    </ChartWrapper>
  );
}
