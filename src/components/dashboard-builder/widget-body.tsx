"use client";

import { ResultView } from "@/components/agent/result-view";
import { Markdown } from "@/components/agent/markdown";
import { buildAnswer, isNumericCell } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget } from "@/lib/integrations/ulink-agent/types";

function formatKpi(value: unknown): string {
  if (isNumericCell(value)) return Number(value).toLocaleString();
  return value === null || value === undefined ? "—" : String(value);
}

export function WidgetBody({ widget }: { widget: Widget }) {
  if (widget.kind === "text") {
    return <Markdown className="text-muted-foreground">{widget.textMd || ""}</Markdown>;
  }

  if (!widget.result) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }

  if (widget.kind === "kpi") {
    const col = widget.result.columns[0];
    const value = widget.result.rows[0]?.[col];
    return (
      <div className="py-2">
        <div className="text-3xl font-bold tabular-nums">{formatKpi(value)}</div>
      </div>
    );
  }

  // chart / table → reuse ResultView. Force chart off for table kind, and honor
  // the stored display so a pinned chart renders the same way it did in chat
  // (display is "table" for table/kpi widgets, so the table-only path is kept).
  const answer = buildAnswer({
    sql: widget.sql,
    chart: widget.kind === "chart" ? widget.chart : { type: "none", xColumn: null, yColumn: null },
    result: widget.result,
  });
  return <ResultView answer={answer} display={widget.display} title={widget.title} />;
}
