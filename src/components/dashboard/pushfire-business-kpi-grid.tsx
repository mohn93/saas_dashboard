"use client";

import { KPICard } from "./kpi-card";
import { DollarSign, FolderKanban, ArrowRightLeft } from "lucide-react";
import type { PushFireBusinessKPIs } from "@/lib/types";

interface PushFireBusinessKPIGridProps {
  kpis: PushFireBusinessKPIs;
  loading?: boolean;
}

export function PushFireBusinessKPIGrid({ kpis, loading }: PushFireBusinessKPIGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="MRR"
        value={kpis.mrr}
        format="currency"
        loading={loading}
        icon={DollarSign}
        accentColor="#34d399"
      />
      <KPICard
        label="Paid Projects"
        value={kpis.paidProjects}
        loading={loading}
        icon={FolderKanban}
        accentColor="#60a5fa"
      />
      <KPICard
        label="Free → Paid"
        value={kpis.signupToPaidRate}
        format="percent"
        loading={loading}
        icon={ArrowRightLeft}
        accentColor="#a78bfa"
      />
    </div>
  );
}
