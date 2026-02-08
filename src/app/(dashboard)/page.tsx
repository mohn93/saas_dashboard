"use client";

import { Suspense } from "react";
import { products } from "@/lib/config/products";
import { useDateRange } from "@/hooks/use-date-range";
import { useMetrics } from "@/hooks/use-metrics";
import { KPIGrid } from "@/components/dashboard/kpi-grid";
import { MultiProductChart } from "@/components/charts/multi-product-chart";
import { CacheIndicator } from "@/components/dashboard/cache-indicator";
import { ChartErrorBoundary } from "@/components/dashboard/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { KPIs, DailyVisitors, ProductSlug } from "@/lib/types";
import Link from "next/link";

function OverviewContent() {
  const { dateRange } = useDateRange();

  const somara = useMetrics("somara", dateRange.start, dateRange.end);
  const ulink = useMetrics("ulink", dateRange.start, dateRange.end);
  const pushfire = useMetrics("pushfire", dateRange.start, dateRange.end);

  const allMetrics = { somara, ulink, pushfire };
  const loading = somara.loading || ulink.loading || pushfire.loading;
  const anyError = somara.error || ulink.error || pushfire.error;

  // Aggregate KPIs
  const aggregatedKPIs: KPIs = {
    totalUsers: 0,
    newUsers: 0,
    sessions: 0,
    pageviews: 0,
    avgSessionDuration: 0,
    bounceRate: 0,
  };

  let productCount = 0;
  for (const key of Object.keys(allMetrics) as ProductSlug[]) {
    const data = allMetrics[key].data;
    if (data) {
      aggregatedKPIs.totalUsers += data.kpis.totalUsers;
      aggregatedKPIs.newUsers += data.kpis.newUsers;
      aggregatedKPIs.sessions += data.kpis.sessions;
      aggregatedKPIs.pageviews += data.kpis.pageviews;
      aggregatedKPIs.avgSessionDuration += data.kpis.avgSessionDuration;
      aggregatedKPIs.bounceRate += data.kpis.bounceRate;
      productCount++;
    }
  }

  if (productCount > 0) {
    aggregatedKPIs.avgSessionDuration /= productCount;
    aggregatedKPIs.bounceRate /= productCount;
  }

  // Visitors data per product
  const visitorsData: Record<string, DailyVisitors[]> = {};
  for (const key of Object.keys(allMetrics) as ProductSlug[]) {
    visitorsData[key] = allMetrics[key].data?.visitorsOverTime || [];
  }

  // Find first cached response for indicator
  const cachedEntry = Object.values(allMetrics).find((m) => m.cached);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground">
            Aggregated metrics across all products
          </p>
        </div>
        {cachedEntry && (
          <CacheIndicator
            cached={cachedEntry.cached}
            cachedAt={cachedEntry.cachedAt}
          />
        )}
      </div>

      <ChartErrorBoundary fallbackMessage="Failed to load KPIs">
        <KPIGrid kpis={aggregatedKPIs} loading={loading} />
      </ChartErrorBoundary>

      <ChartErrorBoundary fallbackMessage="Failed to load visitors chart">
        <MultiProductChart
          data={visitorsData}
          products={products}
          loading={loading}
          error={anyError}
        />
      </ChartErrorBoundary>

      {/* Per-product summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {products.map((product) => {
          const metrics = allMetrics[product.slug];
          return (
            <Link key={product.slug} href={`/${product.slug}`}>
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: product.color }}
                    />
                    <CardTitle className="text-base">{product.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {metrics.loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ) : metrics.error ? (
                    <p className="text-sm text-muted-foreground">
                      Unable to load
                    </p>
                  ) : metrics.data ? (
                    <div className="space-y-1">
                      <p className="text-2xl font-bold tabular-nums">
                        {metrics.data.kpis.totalUsers.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {metrics.data.kpis.sessions.toLocaleString()} sessions
                        &middot;{" "}
                        {metrics.data.kpis.pageviews.toLocaleString()} pageviews
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
