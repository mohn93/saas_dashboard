"use client";

import { KPICard } from "./kpi-card";
import type { ULinkBusinessMetrics } from "@/lib/types";

interface BusinessKPIGridProps {
  metrics: ULinkBusinessMetrics;
  loading?: boolean;
}

export function BusinessKPIGrid({ metrics, loading }: BusinessKPIGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="MRR"
        value={metrics.mrr}
        format="currency"
        loading={loading}
      />
      <KPICard
        label="Visitor → Signup"
        value={metrics.visitorToSignupRate}
        format="percent"
        loading={loading}
      />
      <KPICard
        label="Signup → Paid"
        value={metrics.signupToPaidRate}
        format="percent"
        loading={loading}
      />
    </div>
  );
}
