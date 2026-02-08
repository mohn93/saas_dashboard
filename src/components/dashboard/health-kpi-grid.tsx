"use client";

import { KPICard } from "./kpi-card";
import {
  FolderKanban,
  HeartPulse,
  Settings2,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { ULinkClientHealth } from "@/lib/types";

interface HealthKPIGridProps {
  health: ULinkClientHealth;
  loading?: boolean;
}

export function HealthKPIGrid({ health, loading }: HealthKPIGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KPICard
        label="Total Projects"
        value={health.totalProjects}
        format="number"
        loading={loading}
        icon={FolderKanban as LucideIcon}
        accentColor="#818cf8"
      />
      <HealthDistributionCard
        healthy={health.healthyCount}
        atRisk={health.atRiskCount}
        inactive={health.inactiveCount}
        loading={loading}
      />
      <KPICard
        label="Configured Rate"
        value={health.configuredRate}
        format="percent"
        loading={loading}
        icon={Settings2 as LucideIcon}
        accentColor="#f59e0b"
      />
      <KPICard
        label="Avg Onboarding"
        value={health.avgOnboardingProgress}
        format="percent"
        loading={loading}
        icon={ListChecks as LucideIcon}
        accentColor="#60a5fa"
      />
    </div>
  );
}

function HealthDistributionCard({
  healthy,
  atRisk,
  inactive,
  loading,
}: {
  healthy: number;
  atRisk: number;
  inactive: number;
  loading?: boolean;
}) {
  const Icon = HeartPulse as LucideIcon;

  if (loading) {
    return (
      <KPICard
        label="Health Status"
        value={0}
        format="number"
        loading={true}
        icon={Icon}
        accentColor="#34d399"
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Health Status
          </p>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: "#34d39920" }}
          >
            <Icon className="h-4 w-4" style={{ color: "#34d399" }} />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="flex items-center gap-1 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            {healthy}
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            {atRisk}
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            {inactive}
          </span>
        </div>
        <div
          className="absolute bottom-0 left-0 h-[2px] w-full opacity-50"
          style={{
            background: "linear-gradient(90deg, #34d399, transparent)",
          }}
        />
      </div>
    </div>
  );
}
