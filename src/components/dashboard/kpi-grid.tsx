"use client";

import { KPICard } from "./kpi-card";
import type { KPIs } from "@/lib/types";

interface KPIGridProps {
  kpis: KPIs;
  loading?: boolean;
  visitorLabels?: boolean;
  dashboardLabels?: boolean;
}

export function KPIGrid({ kpis, loading, visitorLabels, dashboardLabels }: KPIGridProps) {
  const userLabel = visitorLabels && !dashboardLabels ? "Total Visitors" : "Total Users";
  const newUserLabel = visitorLabels ? "New Visitors" : "New Users";

  const cards = [
    <KPICard key="users" label={userLabel} value={kpis.totalUsers} loading={loading} />,
    ...(!dashboardLabels
      ? [<KPICard key="new" label={newUserLabel} value={kpis.newUsers} loading={loading} />]
      : []),
    <KPICard key="sessions" label="Sessions" value={kpis.sessions} loading={loading} />,
    <KPICard key="pageviews" label="Pageviews" value={kpis.pageviews} loading={loading} />,
    <KPICard
      key="duration"
      label="Avg. Duration"
      value={kpis.avgSessionDuration}
      format="duration"
      loading={loading}
    />,
    <KPICard
      key="bounce"
      label="Bounce Rate"
      value={kpis.bounceRate}
      format="percent"
      loading={loading}
    />,
  ];

  return (
    <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${dashboardLabels ? "lg:grid-cols-5" : "lg:grid-cols-6"}`}>
      {cards}
    </div>
  );
}
