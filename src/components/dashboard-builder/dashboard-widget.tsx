"use client";

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Trash2, GripVertical, Pencil } from "lucide-react";
import { WidgetBody } from "./widget-body";
import { cn } from "@/lib/utils";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import {
  hasUsableChart,
  inferChartSpec,
  initialChartType,
} from "@/lib/integrations/ulink-agent/widgets";
import {
  SELECTABLE_CHART_TYPES,
  SELECTABLE_WIDGET_KINDS,
  WIDGET_SIZES,
} from "@/lib/integrations/ulink-agent/types";
import type { Widget, WidgetKind, WidgetSize } from "@/lib/integrations/ulink-agent/types";

const SIZE_LABEL: Record<WidgetSize, string> = { sm: "S", md: "M", full: "Full" };

// Build the patch for a render-kind change so the widget stays coherent:
//  - table/kpi always render as a table;
//  - chart shows the chart only (preserving "both" if the table was on), and
//    infers axes from the result when the widget has no usable chart yet (e.g.
//    a table widget switched to chart) so it doesn't render an empty chart.
function kindPatch(kind: WidgetKind, widget: Widget): WidgetPatch {
  if (kind !== "chart") return { kind, display: "table" };
  const display = widget.display === "both" ? "both" : "chart";
  if (hasUsableChart(widget.chart)) return { kind, display };
  const inferred = inferChartSpec(widget.result, initialChartType(widget.chart));
  // If the result can't be charted, keep the table visible ("both") so the
  // widget isn't blank (no chart + collapsed table).
  if (!inferred) return { kind, display: "both", chart: widget.chart };
  return { kind, display, chart: inferred };
}

export function DashboardWidget({
  widget,
  editing,
  refreshing = false,
  dragHandleProps,
  onRefresh,
  onPatch,
  onRemove,
  onEditQuery,
}: {
  widget: Widget;
  editing: boolean;
  refreshing?: boolean;
  dragHandleProps?: Record<string, unknown>;
  onRefresh: () => void;
  onPatch: (patch: WidgetPatch) => void;
  onRemove: () => void;
  onEditQuery: () => void;
}) {
  const isQuery = widget.kind !== "text";
  // Inline title editing (edit mode only). Draft is null when not editing.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Set on Escape so the blur that follows discards instead of committing
  // (state updates are async, so blur can't see a just-reset draft).
  const cancelTitleRef = useRef(false);
  function commitTitle() {
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setTitleDraft(null);
      return;
    }
    const next = titleDraft?.trim();
    if (next && next !== widget.title) onPatch({ title: next });
    setTitleDraft(null);
  }
  const freshness = refreshing
    ? "refreshing…"
    : widget.refreshError
    ? "couldn't refresh — showing cached"
    : widget.cachedAt
    ? `updated ${formatDistanceToNow(new Date(widget.cachedAt), { addSuffix: true })}`
    : isQuery
    ? "📷 cached"
    : "";

  return (
    <div className="flex h-full flex-col rounded-lg border border-border/50 bg-card p-4">
      <div className="mb-2 flex items-start gap-2">
        {editing && (
          <button
            type="button"
            className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={titleDraft ?? widget.title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  cancelTitleRef.current = true;
                  e.currentTarget.blur();
                }
              }}
              aria-label="Widget title"
              className="w-full rounded-md border border-border/50 bg-background px-2 py-1 text-sm font-semibold outline-none focus:border-violet-500"
            />
          ) : (
            <h3 className="truncate text-sm font-semibold">{widget.title}</h3>
          )}
          {freshness && (
            <p className={cn("text-xs", widget.refreshError ? "text-amber-500" : "text-muted-foreground")}>
              {freshness}
            </p>
          )}
        </div>
        {isQuery && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:hover:bg-transparent"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        )}
      </div>

      <div
        className={cn("flex-1 transition-opacity", refreshing && "animate-pulse opacity-60")}
        aria-busy={refreshing}
      >
        <WidgetBody widget={widget} />
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-xs">
          {/* size */}
          <div role="radiogroup" aria-label="Widget size" className="flex overflow-hidden rounded-md border border-border/50">
            {WIDGET_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={widget.size === s}
                onClick={() => onPatch({ size: s })}
                className={cn("px-2 py-1", widget.size === s ? "bg-violet-600 text-white" : "hover:bg-accent")}
              >
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>

          {/* render kind (query widgets only) */}
          {isQuery && (
            <div role="radiogroup" aria-label="Widget type" className="flex overflow-hidden rounded-md border border-border/50">
              {SELECTABLE_WIDGET_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={widget.kind === k}
                  onClick={() => onPatch(kindPatch(k, widget))}
                  className={cn("px-2 py-1 capitalize", widget.kind === k ? "bg-violet-600 text-white" : "hover:bg-accent")}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {/* chart type (chart kind only) */}
          {widget.kind === "chart" && (
            <div role="radiogroup" aria-label="Chart type" className="flex overflow-hidden rounded-md border border-border/50">
              {SELECTABLE_CHART_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={widget.chart?.type === t}
                  onClick={() =>
                    onPatch({ chart: { type: t, xColumn: widget.chart?.xColumn ?? null, yColumn: widget.chart?.yColumn ?? null } })
                  }
                  className={cn("px-2 py-1 capitalize", widget.chart?.type === t ? "bg-violet-600 text-white" : "hover:bg-accent")}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* table visibility (chart kind only) — "a graph without a table" */}
          {widget.kind === "chart" && (
            <button
              type="button"
              aria-pressed={widget.display === "both"}
              onClick={() => onPatch({ display: widget.display === "both" ? "chart" : "both" })}
              className={cn(
                "rounded-md border px-2 py-1",
                widget.display === "both"
                  ? "border-violet-500/50 bg-violet-600 text-white"
                  : "border-border/50 hover:bg-accent"
              )}
            >
              {widget.display === "both" ? "Table on" : "Table off"}
            </button>
          )}

          {isQuery && (
            <button
              type="button"
              onClick={onEditQuery}
              className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 hover:bg-accent"
            >
              <Pencil className="h-3 w-3" /> Edit query
            </button>
          )}

          <button
            type="button"
            onClick={onRemove}
            className="ml-auto flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
