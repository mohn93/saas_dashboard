"use client";

import { Suspense } from "react";
import { products } from "@/lib/config/products";
import { useDateRange } from "@/hooks/use-date-range";
import { useMetrics } from "@/hooks/use-metrics";
import { useSomaraMetrics } from "@/hooks/use-somara-metrics";
import { usePushFireMetrics } from "@/hooks/use-pushfire-metrics";
import { CacheIndicator } from "@/components/dashboard/cache-indicator";
import { ChartErrorBoundary } from "@/components/dashboard/error-boundary";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Bell,
  MessageSquare,
  MousePointerClick,
} from "lucide-react";
import Link from "next/link";

function OverviewContent() {
  const { dateRange } = useDateRange();

  // ULink — GA metrics
  const ulink = useMetrics("ulink", dateRange.start, dateRange.end);
  // Somara — platform DB metrics
  const somara = useSomaraMetrics(dateRange.start, dateRange.end);
  // PushFire — platform DB metrics
  const pushfire = usePushFireMetrics(dateRange.start, dateRange.end);

  const loading = ulink.loading || somara.loading || pushfire.loading;

  // Aggregate cross-product KPIs from each data source
  const totalUsers =
    (ulink.data?.kpis.totalUsers || 0) +
    (somara.data?.kpis.totalUsers || 0) +
    (pushfire.data?.kpis.totalUsers || 0);

  const totalSessions = ulink.data?.kpis.sessions || 0;
  const totalMessages = somara.data?.kpis.totalMessages || 0;
  const totalNotifications = pushfire.data?.kpis.notificationsSent || 0;

  // Find first cached response for indicator
  const cachedEntry = [ulink, somara, pushfire].find((m) => m.cached);

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

      <ChartErrorBoundary fallbackMessage="Failed to load overview KPIs">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPICard
            label="Total Users"
            value={totalUsers}
            loading={loading}
            icon={Users}
            accentColor="#818cf8"
          />
          <KPICard
            label="Sessions"
            value={totalSessions}
            loading={loading}
            icon={MousePointerClick}
            accentColor="#f59e0b"
          />
          <KPICard
            label="Messages"
            value={totalMessages}
            loading={loading}
            icon={MessageSquare}
            accentColor="#6366f1"
          />
          <KPICard
            label="Notifications"
            value={totalNotifications}
            loading={loading}
            icon={Bell}
            accentColor="#ef4444"
          />
        </div>
      </ChartErrorBoundary>

      {/* Per-product summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Somara */}
        <Link href="/somara">
          <Card className="transition-shadow hover:shadow-md cursor-pointer">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: products[0].color }}
                />
                <CardTitle className="text-base">Somara</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {somara.loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : somara.error ? (
                <p className="text-sm text-muted-foreground">Unable to load</p>
              ) : somara.data ? (
                <div className="space-y-1">
                  <p className="text-2xl font-bold tabular-nums">
                    {somara.data.kpis.totalUsers.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {somara.data.kpis.totalMessages.toLocaleString()} messages
                    &middot;{" "}
                    {somara.data.kpis.tokensUsed.toLocaleString()} tokens
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* ULink */}
        <Link href="/ulink">
          <Card className="transition-shadow hover:shadow-md cursor-pointer">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: products[1].color }}
                />
                <CardTitle className="text-base">ULink</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {ulink.loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : ulink.error ? (
                <p className="text-sm text-muted-foreground">Unable to load</p>
              ) : ulink.data ? (
                <div className="space-y-1">
                  <p className="text-2xl font-bold tabular-nums">
                    {ulink.data.kpis.totalUsers.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ulink.data.kpis.sessions.toLocaleString()} sessions
                    &middot;{" "}
                    {ulink.data.kpis.pageviews.toLocaleString()} pageviews
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* PushFire */}
        <Link href="/pushfire">
          <Card className="transition-shadow hover:shadow-md cursor-pointer">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: products[2].color }}
                />
                <CardTitle className="text-base">PushFire</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {pushfire.loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : pushfire.error ? (
                <p className="text-sm text-muted-foreground">Unable to load</p>
              ) : pushfire.data ? (
                <div className="space-y-1">
                  <p className="text-2xl font-bold tabular-nums">
                    {pushfire.data.kpis.totalSubscribers.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pushfire.data.kpis.notificationsSent.toLocaleString()} notifs
                    &middot;{" "}
                    {(pushfire.data.kpis.deliverySuccessRate * 100).toFixed(1)}% delivered
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </Link>
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
