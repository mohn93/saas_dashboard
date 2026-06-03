"use client";

import { cn } from "@/lib/utils";
import {
  SELECTABLE_CHART_TYPES,
  SELECTABLE_WIDGET_KINDS,
} from "@/lib/integrations/ulink-agent/types";
import type { ChartType, WidgetKind } from "@/lib/integrations/ulink-agent/types";

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
      <div
        role="radiogroup"
        aria-label="Widget type"
        className="flex overflow-hidden rounded-md border border-border/50 text-xs"
      >
        {SELECTABLE_WIDGET_KINDS.map((k) => {
          const disabled = k === "chart" && !chartable;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
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
        <div
          role="radiogroup"
          aria-label="Chart type"
          className="flex overflow-hidden rounded-md border border-border/50 text-xs"
        >
          {SELECTABLE_CHART_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={chartType === t}
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
