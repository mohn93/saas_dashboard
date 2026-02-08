"use client";

import { KPICard } from "./kpi-card";
import { CreditCard, Coins, ArrowRightLeft } from "lucide-react";
import type { SomaraBusinessKPIs } from "@/lib/types";

interface SomaraBusinessKPIGridProps {
  kpis: SomaraBusinessKPIs;
  loading?: boolean;
}

export function SomaraBusinessKPIGrid({ kpis, loading }: SomaraBusinessKPIGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="Active Subscribers"
        value={kpis.activeSubscribers}
        loading={loading}
        icon={CreditCard}
        accentColor="#6366f1"
      />
      <KPICard
        label="Credits Purchased"
        value={kpis.creditsPurchased}
        loading={loading}
        icon={Coins}
        accentColor="#34d399"
      />
      <KPICard
        label="Signup → Paid"
        value={kpis.signupToPaidRate}
        format="percent"
        loading={loading}
        icon={ArrowRightLeft}
        accentColor="#a78bfa"
      />
    </div>
  );
}
