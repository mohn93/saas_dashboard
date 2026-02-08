"use client";

import { Suspense } from "react";
import { notFound, useParams } from "next/navigation";
import { isValidProductSlug, getProduct } from "@/lib/config/products";
import { useDateRange } from "@/hooks/use-date-range";
import { useMetrics } from "@/hooks/use-metrics";
import { useULinkMetrics } from "@/hooks/use-ulink-metrics";
import { useULinkHealth } from "@/hooks/use-ulink-health";
import { useSomaraMetrics } from "@/hooks/use-somara-metrics";
import { usePushFireMetrics } from "@/hooks/use-pushfire-metrics";
import { KPIGrid } from "@/components/dashboard/kpi-grid";
import { BusinessKPIGrid } from "@/components/dashboard/business-kpi-grid";
import { HealthKPIGrid } from "@/components/dashboard/health-kpi-grid";
import { ProjectHealthTable } from "@/components/dashboard/project-health-table";
import { VisitorsLineChart } from "@/components/charts/visitors-line-chart";
import { TopPagesTable } from "@/components/charts/top-pages-table";
import { ReferrersTable } from "@/components/charts/referrers-table";
import { CountryBreakdown } from "@/components/charts/country-breakdown";
import { DeviceBreakdown } from "@/components/charts/device-breakdown";
import { MRRChart } from "@/components/charts/mrr-chart";
import { SignupsChart } from "@/components/charts/signups-chart";
import { HealthStatusChart } from "@/components/charts/health-status-chart";
import { SomaraKPIGrid } from "@/components/dashboard/somara-kpi-grid";
import { SomaraBusinessKPIGrid } from "@/components/dashboard/somara-business-kpi-grid";
import { SubscriptionsChart } from "@/components/charts/subscriptions-chart";
import { CreditPurchasesChart } from "@/components/charts/credit-purchases-chart";
import { PushFireKPIGrid } from "@/components/dashboard/pushfire-kpi-grid";
import { PushFireBusinessKPIGrid } from "@/components/dashboard/pushfire-business-kpi-grid";
import { SubscribersOverTimeChart } from "@/components/charts/subscribers-over-time-chart";
import { NotificationsChart } from "@/components/charts/notifications-chart";
import { ExecutionsChart } from "@/components/charts/executions-chart";
import { DeviceOSChart } from "@/components/charts/device-os-chart";
import { ActivityChart } from "@/components/charts/activity-chart";
import { TokenUsageChart } from "@/components/charts/token-usage-chart";
import { OrgBillingChart } from "@/components/charts/org-billing-chart";
import { TopModelsChart } from "@/components/charts/top-models-chart";
import { CreditsTable } from "@/components/charts/credits-table";
import { CacheIndicator } from "@/components/dashboard/cache-indicator";
import { ChartErrorBoundary } from "@/components/dashboard/error-boundary";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProductSlug, ULinkBusinessMetrics, ULinkClientHealth } from "@/lib/types";

const emptyBusinessMetrics: ULinkBusinessMetrics = {
  mrr: 0,
  totalSignups: 0,
  totalPaidUsers: 0,
  visitorToSignupRate: 0,
  signupToPaidRate: 0,
  signupsOverTime: [],
  mrrOverTime: [],
};

const emptyClientHealth: ULinkClientHealth = {
  totalProjects: 0,
  healthyCount: 0,
  atRiskCount: 0,
  inactiveCount: 0,
  avgOnboardingProgress: 0,
  configuredRate: 0,
  projectsWithLinks: 0,
  projects: [],
};

const emptySomaraKPIs = {
  totalUsers: 0,
  activeUsers: 0,
  newSignups: 0,
  totalMessages: 0,
  totalChats: 0,
  tokensUsed: 0,
};

const emptySomaraBusinessKPIs = {
  activeSubscribers: 0,
  creditsPurchased: 0,
  signupToPaidRate: 0,
};

const emptyPushFireKPIs = {
  totalUsers: 0,
  totalProjects: 0,
  totalSubscribers: 0,
  totalDevices: 0,
  notificationsSent: 0,
  deliverySuccessRate: 0,
};

const emptyPushFireBusinessKPIs = {
  mrr: 0,
  paidProjects: 0,
  signupToPaidRate: 0,
};

function ProductContent() {
  const params = useParams();
  const slug = params.product as string;

  if (!isValidProductSlug(slug)) {
    notFound();
  }

  const product = getProduct(slug)!;
  const { dateRange } = useDateRange();
  // Only fetch GA metrics when the product has GA configured
  const { data, loading, error, cached, cachedAt } = useMetrics(
    slug as ProductSlug,
    product.hasGAMetrics ? dateRange.start : "",
    product.hasGAMetrics ? dateRange.end : ""
  );

  // Conditionally fetch ULink business metrics
  const ulinkMetrics = useULinkMetrics(
    product.hasBusinessMetrics ? dateRange.start : "",
    product.hasBusinessMetrics ? dateRange.end : ""
  );

  // Conditionally fetch ULink client health
  const ulinkHealth = useULinkHealth(
    product.hasBusinessMetrics ? dateRange.start : "",
    product.hasBusinessMetrics ? dateRange.end : ""
  );

  // Conditionally fetch Somara platform metrics
  const somaraMetrics = useSomaraMetrics(
    product.hasSomaraMetrics ? dateRange.start : "",
    product.hasSomaraMetrics ? dateRange.end : ""
  );

  // Conditionally fetch PushFire platform metrics
  const pushfireMetrics = usePushFireMetrics(
    product.hasPushFireMetrics ? dateRange.start : "",
    product.hasPushFireMetrics ? dateRange.end : ""
  );

  const emptyKPIs = {
    totalUsers: 0,
    newUsers: 0,
    sessions: 0,
    pageviews: 0,
    avgSessionDuration: 0,
    bounceRate: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: product.color }}
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {product.name}
            </h1>
            <p className="text-muted-foreground">
              Analytics breakdown for {product.name}
            </p>
          </div>
        </div>
        <CacheIndicator cached={cached} cachedAt={cachedAt} />
      </div>

      {/* GA Analytics Section — skip when no GA property */}
      {product.hasGAMetrics && (
        <>
          <ChartErrorBoundary fallbackMessage="Failed to load KPIs">
            <KPIGrid kpis={data?.kpis || emptyKPIs} loading={loading} />
          </ChartErrorBoundary>

          <ChartErrorBoundary fallbackMessage="Failed to load visitors chart">
            <VisitorsLineChart
              data={data?.visitorsOverTime || []}
              loading={loading}
              error={error}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load top pages">
              <TopPagesTable
                data={data?.topPages || []}
                loading={loading}
                error={error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load referrers">
              <ReferrersTable
                data={data?.referrers || []}
                loading={loading}
                error={error}
              />
            </ChartErrorBoundary>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load country breakdown">
              <CountryBreakdown
                data={data?.countries || []}
                loading={loading}
                error={error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load device breakdown">
              <DeviceBreakdown
                data={data?.devices || []}
                loading={loading}
                error={error}
              />
            </ChartErrorBoundary>
          </div>
        </>
      )}

      {/* Somara Platform Metrics Section */}
      {product.hasSomaraMetrics && (
        <>
          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Platform Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Usage and engagement data for {product.name}
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load Somara KPIs">
            <SomaraKPIGrid
              kpis={somaraMetrics.data?.kpis || emptySomaraKPIs}
              loading={somaraMetrics.loading}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load activity chart">
              <ActivityChart
                data={somaraMetrics.data?.activityOverTime || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load signups chart">
              <SignupsChart
                data={somaraMetrics.data?.signupsOverTime || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load token usage chart">
              <TokenUsageChart
                data={somaraMetrics.data?.tokenUsageOverTime || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load billing chart">
              <OrgBillingChart
                data={somaraMetrics.data?.orgBillingBreakdown || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load top models">
              <TopModelsChart
                data={somaraMetrics.data?.topModels || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load credits overview">
              <CreditsTable
                data={somaraMetrics.data?.creditsOverview || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Business Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Subscription health and credit revenue for {product.name}
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load business KPIs">
            <SomaraBusinessKPIGrid
              kpis={somaraMetrics.data?.businessKpis || emptySomaraBusinessKPIs}
              loading={somaraMetrics.loading}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load subscriptions chart">
              <SubscriptionsChart
                data={somaraMetrics.data?.subscriptionsOverTime || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load credit purchases chart">
              <CreditPurchasesChart
                data={somaraMetrics.data?.creditPurchasesOverTime || []}
                loading={somaraMetrics.loading}
                error={somaraMetrics.error}
              />
            </ChartErrorBoundary>
          </div>
        </>
      )}

      {/* PushFire Platform Metrics Section */}
      {product.hasPushFireMetrics && (
        <>
          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Platform Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Usage and engagement data for {product.name}
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load PushFire KPIs">
            <PushFireKPIGrid
              kpis={pushfireMetrics.data?.kpis || emptyPushFireKPIs}
              loading={pushfireMetrics.loading}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load subscribers chart">
              <SubscribersOverTimeChart
                data={pushfireMetrics.data?.subscribersOverTime || []}
                loading={pushfireMetrics.loading}
                error={pushfireMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load notifications chart">
              <NotificationsChart
                data={pushfireMetrics.data?.notificationsOverTime || []}
                loading={pushfireMetrics.loading}
                error={pushfireMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load executions chart">
              <ExecutionsChart
                data={pushfireMetrics.data?.executionsOverTime || []}
                loading={pushfireMetrics.loading}
                error={pushfireMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load device breakdown">
              <DeviceOSChart
                data={pushfireMetrics.data?.deviceBreakdown || []}
                loading={pushfireMetrics.loading}
                error={pushfireMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Business Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Revenue and conversion data for {product.name}
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load PushFire business KPIs">
            <PushFireBusinessKPIGrid
              kpis={pushfireMetrics.data?.businessKpis || emptyPushFireBusinessKPIs}
              loading={pushfireMetrics.loading}
            />
          </ChartErrorBoundary>
        </>
      )}

      {/* Business Metrics Section — ULink only */}
      {product.hasBusinessMetrics && (
        <>
          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Business Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Revenue and conversion data for {product.name}
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load business KPIs">
            <BusinessKPIGrid
              metrics={ulinkMetrics.data || emptyBusinessMetrics}
              loading={ulinkMetrics.loading}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load MRR chart">
              <MRRChart
                data={ulinkMetrics.data?.mrrOverTime || []}
                loading={ulinkMetrics.loading}
                error={ulinkMetrics.error}
              />
            </ChartErrorBoundary>

            <ChartErrorBoundary fallbackMessage="Failed to load signups chart">
              <SignupsChart
                data={ulinkMetrics.data?.signupsOverTime || []}
                loading={ulinkMetrics.loading}
                error={ulinkMetrics.error}
              />
            </ChartErrorBoundary>
          </div>

          {/* Client Health Section */}
          <Separator />

          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Client Health
            </h2>
            <p className="text-sm text-muted-foreground">
              Project onboarding and usage status
            </p>
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load health KPIs">
            <HealthKPIGrid
              health={ulinkHealth.data || emptyClientHealth}
              loading={ulinkHealth.loading}
            />
          </ChartErrorBoundary>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartErrorBoundary fallbackMessage="Failed to load health chart">
              <HealthStatusChart
                health={ulinkHealth.data || emptyClientHealth}
                loading={ulinkHealth.loading}
                error={ulinkHealth.error}
              />
            </ChartErrorBoundary>

            <div /> {/* Placeholder for balanced grid */}
          </div>

          <ChartErrorBoundary fallbackMessage="Failed to load project table">
            <ProjectHealthTable
              projects={ulinkHealth.data?.projects || []}
              loading={ulinkHealth.loading}
            />
          </ChartErrorBoundary>
        </>
      )}
    </div>
  );
}

export default function ProductPage() {
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
      <ProductContent />
    </Suspense>
  );
}
