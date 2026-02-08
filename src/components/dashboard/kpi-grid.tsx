"use client";

import { KPICard } from "./kpi-card";
import type { KPIs } from "@/lib/types";

interface KPIGridProps {
  kpis: KPIs;
  loading?: boolean;
}

export function KPIGrid({ kpis, loading }: KPIGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      <KPICard label="Total Users" value={kpis.totalUsers} loading={loading} />
      <KPICard label="New Users" value={kpis.newUsers} loading={loading} />
      <KPICard label="Sessions" value={kpis.sessions} loading={loading} />
      <KPICard label="Pageviews" value={kpis.pageviews} loading={loading} />
      <KPICard
        label="Avg. Duration"
        value={kpis.avgSessionDuration}
        format="duration"
        loading={loading}
      />
      <KPICard
        label="Bounce Rate"
        value={kpis.bounceRate}
        format="percent"
        loading={loading}
      />
    </div>
  );
}
