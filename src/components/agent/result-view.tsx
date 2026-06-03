"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { BarChart, LineChart, AreaChart, DonutChart } from "@tremor/react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { PaginatedTable } from "./data-table";
import { hasUsableChart } from "@/lib/integrations/ulink-agent/widgets";
import { chartLabels } from "@/lib/integrations/ulink-agent/format";
import type { AgentAnswer, DisplayMode } from "@/lib/integrations/ulink-agent/types";

// Rows shown per page inline vs. in the expanded fullscreen view.
const INLINE_PAGE_SIZE = 10;
const FULLSCREEN_PAGE_SIZE = 50;

// Explicit, dark-theme-friendly palette so charts never fall back to Tremor's
// default colors (which render an unreadable near-black slice on our dark bg).
// Violet first to lead with the app accent; all entries stay vivid on dark.
const CHART_COLORS = [
  "violet",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "rose",
  "indigo",
  "fuchsia",
  "teal",
  "sky",
  "orange",
  "lime",
];

function Chart({ answer }: { answer: AgentAnswer }) {
  const { chart, result } = answer;
  if (!result || !hasUsableChart(chart)) return null;
  const xCol = chart.xColumn;
  const yCol = chart.yColumn;
  // Humanize the x value (ISO dates → "Aug 29, 2025") so axis ticks and tooltips
  // never show raw "2025-08-29T00:00:00.000Z". chartLabels keeps labels distinct
  // (won't collapse intraday rows onto a shared day) so points/slices don't merge.
  const xLabels = chartLabels(result.rows.map((r) => r[xCol]));
  const data = result.rows.map((r, i) => ({
    [xCol]: xLabels[i],
    [yCol]: Number(r[yCol]) || 0,
  }));
  const categories: string[] = [yCol];

  let el: JSX.Element;
  if (chart.type === "pie") {
    el = (
      <DonutChart
        data={data}
        category={yCol}
        index={xCol}
        variant="pie"
        colors={CHART_COLORS}
        className="h-64 mt-4"
      />
    );
  } else if (chart.type === "line") {
    el = <LineChart data={data} index={xCol} categories={categories} colors={CHART_COLORS} className="h-64 mt-4" />;
  } else if (chart.type === "area") {
    el = <AreaChart data={data} index={xCol} categories={categories} colors={CHART_COLORS} className="h-64 mt-4" />;
  } else {
    el = <BarChart data={data} index={xCol} categories={categories} colors={CHART_COLORS} className="h-64 mt-4" />;
  }

  // Charts render as SVG with no inherent text alternative; give the whole
  // chart an accessible name so a chart-only answer isn't silent to a SR.
  return (
    <div role="img" aria-label={`${chart.type} chart: ${yCol} by ${xCol}`}>
      {el}
    </div>
  );
}

export function ResultView({
  answer,
  display = "both",
  title = "Result",
}: {
  answer: AgentAnswer;
  display?: DisplayMode;
  title?: string;
}) {
  const [showSql, setShowSql] = useState(false);
  const [showTable, setShowTable] = useState(display !== "chart");

  if (!answer.ok) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {answer.error || "Something went wrong."}
        {answer.sql && (
          <pre className="mt-2 overflow-x-auto text-xs text-red-200/80">{answer.sql}</pre>
        )}
      </div>
    );
  }

  const result = answer.result!;
  const showChart = display !== "table";
  const tableCollapsible = display === "chart";
  const tableVisible = !tableCollapsible || showTable;

  return (
    <div className="space-y-3">
      {showChart && <Chart answer={answer} />}

      {tableCollapsible && (
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="text-xs font-medium text-violet-400 hover:text-violet-300"
        >
          {showTable ? "Hide table" : "Show table"}
        </button>
      )}

      {tableVisible && (
        <>
          <PaginatedTable result={result} pageSize={INLINE_PAGE_SIZE} />

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 font-medium text-violet-400 hover:text-violet-300"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Expand
                </button>
              </DialogTrigger>
              <DialogContent title={title} description="Full query result, paginated">
                <PaginatedTable result={result} pageSize={FULLSCREEN_PAGE_SIZE} />
              </DialogContent>
            </Dialog>

            {answer.sql && (
              <button
                type="button"
                onClick={() => setShowSql((s) => !s)}
                className="ml-auto text-muted-foreground underline-offset-2 hover:underline"
              >
                {showSql ? "Hide SQL" : "View SQL"}
              </button>
            )}
          </div>

          {showSql && answer.sql && (
            <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
              {answer.sql}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
