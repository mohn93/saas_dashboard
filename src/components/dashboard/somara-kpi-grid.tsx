"use client";

import { KPICard } from "./kpi-card";
import {
  Users,
  Activity,
  UserPlus,
  MessageSquare,
  MessageCircle,
  Zap,
} from "lucide-react";
import type { SomaraKPIs } from "@/lib/types";

interface SomaraKPIGridProps {
  kpis: SomaraKPIs;
  loading?: boolean;
}

export function SomaraKPIGrid({ kpis, loading }: SomaraKPIGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      <KPICard
        label="Total Users"
        value={kpis.totalUsers}
        loading={loading}
        icon={Users}
        accentColor="#818cf8"
      />
      <KPICard
        label="Active Users"
        value={kpis.activeUsers}
        loading={loading}
        icon={Activity}
        accentColor="#8b5cf6"
      />
      <KPICard
        label="New Signups"
        value={kpis.newSignups}
        loading={loading}
        icon={UserPlus}
        accentColor="#34d399"
      />
      <KPICard
        label="Messages"
        value={kpis.totalMessages}
        loading={loading}
        icon={MessageSquare}
        accentColor="#60a5fa"
      />
      <KPICard
        label="Chats"
        value={kpis.totalChats}
        loading={loading}
        icon={MessageCircle}
        accentColor="#a78bfa"
      />
      <KPICard
        label="Tokens Used"
        value={kpis.tokensUsed}
        loading={loading}
        icon={Zap}
        accentColor="#fbbf24"
      />
    </div>
  );
}
