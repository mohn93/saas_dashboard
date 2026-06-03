"use client";

import { ResultView } from "@/components/agent/result-view";
import { Markdown } from "@/components/agent/markdown";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";
import type { Widget } from "@/lib/integrations/ulink-agent/types";

function formatKpi(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value).toLocaleString();
  }
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

  // chart / table → reuse ResultView. Force chart off for table kind.
  const answer: AgentAnswer = {
    ok: true,
    sql: widget.sql,
    chart: widget.kind === "chart" ? widget.chart : { type: "none", xColumn: null, yColumn: null },
    result: widget.result,
    error: null,
    attempts: 0,
    logId: null,
  };
  return <ResultView answer={answer} />;
}
