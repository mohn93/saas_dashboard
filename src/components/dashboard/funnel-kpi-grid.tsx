"use client";

import { KPICard } from "./kpi-card";

interface FunnelKPIGridProps {
  signups: number;
  activeProjects: number;
  payingCustomers: number;
  loading?: boolean;
}

export function FunnelKPIGrid({
  signups,
  activeProjects,
  payingCustomers,
  loading,
}: FunnelKPIGridProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <KPICard label="Signups" value={signups} loading={loading} />
      <KPICard label="Active Projects" value={activeProjects} loading={loading} />
      <KPICard label="Paying Customers" value={payingCustomers} loading={loading} />
    </div>
  );
}
