"use client";

import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Trash2, GripVertical, Pencil } from "lucide-react";
import { WidgetBody } from "./widget-body";
import { cn } from "@/lib/utils";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget, WidgetKind, WidgetSize } from "@/lib/integrations/ulink-agent/types";

const SIZES: WidgetSize[] = ["sm", "md", "full"];
const SIZE_LABEL: Record<WidgetSize, string> = { sm: "S", md: "M", full: "Full" };
const KINDS: WidgetKind[] = ["chart", "table", "kpi"];
const CHART_TYPES = ["bar", "line", "area"] as const;

export function DashboardWidget({
  widget,
  editing,
  dragHandleProps,
  onRefresh,
  onPatch,
  onRemove,
  onEditQuery,
}: {
  widget: Widget;
  editing: boolean;
  dragHandleProps?: Record<string, unknown>;
  onRefresh: () => void;
  onPatch: (patch: WidgetPatch) => void;
  onRemove: () => void;
  onEditQuery: () => void;
}) {
  const isQuery = widget.kind !== "text";
  const freshness = widget.refreshError
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
          <h3 className="truncate text-sm font-semibold">{widget.title}</h3>
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
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1">
        <WidgetBody widget={widget} />
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-xs">
          {/* size */}
          <div className="flex overflow-hidden rounded-md border border-border/50">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPatch({ size: s })}
                className={cn("px-2 py-1", widget.size === s ? "bg-violet-600 text-white" : "hover:bg-accent")}
              >
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>

          {/* render kind (query widgets only) */}
          {isQuery && (
            <div className="flex overflow-hidden rounded-md border border-border/50">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPatch({ kind: k })}
                  className={cn("px-2 py-1 capitalize", widget.kind === k ? "bg-violet-600 text-white" : "hover:bg-accent")}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {/* chart type (chart kind only) */}
          {widget.kind === "chart" && (
            <div className="flex overflow-hidden rounded-md border border-border/50">
              {CHART_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
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
