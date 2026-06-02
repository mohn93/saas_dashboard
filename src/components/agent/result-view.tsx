"use client";

import { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { BarChart, LineChart, AreaChart } from "@tremor/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentAnswer } from "@/lib/integrations/ulink-agent/types";

const COLLAPSED_ROWS = 4;
const MAX_ROWS = 100;

// ISO date or datetime, e.g. "2026-05-06" or "2026-05-06T04:44:25.000Z".
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function renderCell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/40">—</span>;
  }

  // Humanize ISO dates/timestamps, with the exact date on hover (no raw ISO).
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = parseISO(value);
    if (isValid(d)) {
      const hasTime = /[T ]\d{2}:\d{2}/.test(value);
      const display = hasTime
        ? format(d, "MMM d, yyyy, h:mm a")
        : format(d, "MMM d, yyyy");
      const exact = hasTime
        ? format(d, "EEEE, MMMM d, yyyy 'at' h:mm:ss a")
        : format(d, "EEEE, MMMM d, yyyy");
      return (
        <span
          title={exact}
          className="cursor-help whitespace-nowrap underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
        >
          {display}
        </span>
      );
    }
  }

  if (typeof value === "object") {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }

  return <span>{String(value)}</span>;
}

function Chart({ answer }: { answer: AgentAnswer }) {
  const { chart, result } = answer;
  if (!chart || chart.type === "none" || !chart.xColumn || !chart.yColumn || !result) {
    return null;
  }
  const xCol = chart.xColumn;
  const yCol = chart.yColumn;
  const data = result.rows.map((r) => ({
    [xCol]: String(r[xCol]),
    [yCol]: Number(r[yCol]) || 0,
  }));
  const categories: string[] = [yCol];

  if (chart.type === "line")
    return <LineChart data={data} index={xCol} categories={categories} className="h-64 mt-4" />;
  if (chart.type === "area")
    return <AreaChart data={data} index={xCol} categories={categories} className="h-64 mt-4" />;
  return <BarChart data={data} index={xCol} categories={categories} className="h-64 mt-4" />;
}

export function ResultView({ answer }: { answer: AgentAnswer }) {
  const [showSql, setShowSql] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
  const cappedRows = result.rows.slice(0, MAX_ROWS);
  const visibleRows = expanded ? cappedRows : cappedRows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = cappedRows.length - visibleRows.length;

  return (
    <div className="space-y-3">
      <Chart answer={answer} />

      <div className="overflow-x-auto rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              {result.columns.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, i) => (
              <TableRow key={i}>
                {result.columns.map((c) => (
                  <TableCell key={c}>{renderCell(row[c])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
          {result.rowCount > MAX_ROWS ? ` (first ${MAX_ROWS} shown)` : ""}
          {!expanded && hiddenCount > 0 ? ` · showing ${visibleRows.length}` : ""}
        </p>
        {cappedRows.length > COLLAPSED_ROWS && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs font-medium text-violet-400 hover:text-violet-300"
          >
            {expanded ? "Show less" : `Show all ${cappedRows.length}`}
          </button>
        )}
        <button
          onClick={() => setShowSql((s) => !s)}
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showSql ? "Hide SQL" : "View SQL"}
        </button>
      </div>

      {showSql && (
        <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
          {answer.sql}
        </pre>
      )}
    </div>
  );
}
