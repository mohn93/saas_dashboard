"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserPlus,
  MousePointerClick,
  Eye,
  Clock,
  TrendingDown,
  DollarSign,
  ArrowRightLeft,
  Globe,
  CreditCard,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";

type FormatType = "number" | "duration" | "percent" | "currency";

interface KPICardProps {
  label: string;
  value: number;
  format?: FormatType;
  loading?: boolean;
  icon?: LucideIcon;
  accentColor?: string;
}

function formatValue(value: number, type: FormatType): string {
  switch (type) {
    case "duration": {
      const minutes = Math.floor(value / 60);
      const seconds = Math.round(value % 60);
      return `${minutes}m ${seconds}s`;
    }
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "currency":
      return `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}`;
    case "number":
    default:
      return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
}

const defaultIconMap: Record<string, LucideIcon> = {
  "Total Users": Users,
  "New Users": UserPlus,
  "Total Visitors": Users,
  "New Visitors": UserPlus,
  Sessions: MousePointerClick,
  Pageviews: Eye,
  "Avg. Duration": Clock,
  "Bounce Rate": TrendingDown,
  MRR: DollarSign,
  "Visitor → Signup": ArrowRightLeft,
  "Signup → Paid": ArrowRightLeft,
  "Website Visitors": Globe,
  Signups: UserPlus,
  "Active Projects": FolderKanban,
  "Paying Customers": CreditCard,
};

const defaultColorMap: Record<string, string> = {
  "Total Users": "#818cf8",
  "New Users": "#34d399",
  "Total Visitors": "#818cf8",
  "New Visitors": "#34d399",
  Sessions: "#60a5fa",
  Pageviews: "#a78bfa",
  "Avg. Duration": "#fbbf24",
  "Bounce Rate": "#f87171",
  MRR: "#34d399",
  "Visitor → Signup": "#60a5fa",
  "Signup → Paid": "#a78bfa",
  "Website Visitors": "#818cf8",
  Signups: "#34d399",
  "Active Projects": "#60a5fa",
  "Paying Customers": "#fbbf24",
};

export function KPICard({
  label,
  value,
  format = "number",
  loading,
  icon,
  accentColor,
}: KPICardProps) {
  const Icon = icon || defaultIconMap[label] || Users;
  const color = accentColor || defaultColorMap[label] || "#818cf8";

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-24" />
        ) : (
          <div className="mt-2">
            <span className="text-2xl font-bold tabular-nums tracking-tight">
              {formatValue(value, format)}
            </span>
          </div>
        )}
        {/* Bottom accent line */}
        <div
          className="absolute bottom-0 left-0 h-[2px] w-full opacity-50"
          style={{
            background: `linear-gradient(90deg, ${color}, transparent)`,
          }}
        />
      </CardContent>
    </Card>
  );
}
