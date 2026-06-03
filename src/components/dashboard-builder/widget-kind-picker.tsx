"use client";

import { cn } from "@/lib/utils";
import type { ChartType, WidgetKind } from "@/lib/integrations/ulink-agent/types";

const KINDS: Exclude<WidgetKind, "text">[] = ["table", "chart", "kpi"];
const CHART_TYPES: ChartType[] = ["bar", "line", "area", "pie"];

export function WidgetKindPicker({
  kind,
  chartType,
  chartable,
  onKindChange,
  onChartTypeChange,
}: {
  kind: WidgetKind;
  chartType: ChartType;
  chartable: boolean;
  onKindChange: (k: WidgetKind) => void;
  onChartTypeChange: (t: ChartType) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
        {KINDS.map((k) => {
          const disabled = k === "chart" && !chartable;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onKindChange(k)}
              title={disabled ? "Needs a label + a numeric column" : undefined}
              className={cn(
                "flex-1 px-2 py-1 capitalize",
                kind === k ? "bg-violet-600 text-white" : "hover:bg-accent",
                disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {k}
            </button>
          );
        })}
      </div>
      {kind === "chart" && (
        <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
          {CHART_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChartTypeChange(t)}
              className={cn(
                "flex-1 px-2 py-1 capitalize",
                chartType === t ? "bg-violet-600 text-white" : "hover:bg-accent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
