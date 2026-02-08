"use client";

import { KPICard } from "./kpi-card";
import {
  Users,
  FolderKanban,
  UserCheck,
  Smartphone,
  Bell,
  CheckCircle,
} from "lucide-react";
import type { PushFireKPIs } from "@/lib/types";

interface PushFireKPIGridProps {
  kpis: PushFireKPIs;
  loading?: boolean;
}

export function PushFireKPIGrid({ kpis, loading }: PushFireKPIGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      <KPICard
        label="Total Users"
        value={kpis.totalUsers}
        loading={loading}
        icon={Users}
        accentColor="#f87171"
      />
      <KPICard
        label="Projects"
        value={kpis.totalProjects}
        loading={loading}
        icon={FolderKanban}
        accentColor="#fb923c"
      />
      <KPICard
        label="Subscribers"
        value={kpis.totalSubscribers}
        loading={loading}
        icon={UserCheck}
        accentColor="#f59e0b"
      />
      <KPICard
        label="Devices"
        value={kpis.totalDevices}
        loading={loading}
        icon={Smartphone}
        accentColor="#34d399"
      />
      <KPICard
        label="Notifs Sent"
        value={kpis.notificationsSent}
        loading={loading}
        icon={Bell}
        accentColor="#60a5fa"
      />
      <KPICard
        label="Delivery Rate"
        value={kpis.deliverySuccessRate}
        format="percent"
        loading={loading}
        icon={CheckCircle}
        accentColor="#a78bfa"
      />
    </div>
  );
}
