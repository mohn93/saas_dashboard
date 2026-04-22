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
        description="Signups in the selected period ÷ GA visitors in the same period. Both sides use the same window, so it's a period-to-period ratio — not per-visitor attribution."
      />
      <KPICard
        label="Signup → Paid"
        value={metrics.signupToPaidRate}
        format="percent"
        loading={loading}
        description="Cohort metric: of users who signed up in the selected period, how many are on a paid plan today. Recent cohorts skew low because they haven't had time to convert — longer windows (90+ days) are more reliable."
      />
    </div>
  );
}
