"use client";

import { useState } from "react";
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
            {result.rows.slice(0, 100).map((row, i) => (
              <TableRow key={i}>
                {result.columns.map((c) => (
                  <TableCell key={c}>{String(row[c] ?? "")}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
        {result.rowCount > 100 ? " (showing first 100)" : ""}
      </p>

      <button
        onClick={() => setShowSql((s) => !s)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {showSql ? "Hide SQL" : "View SQL"}
      </button>
      {showSql && (
        <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
          {answer.sql}
        </pre>
      )}
    </div>
  );
}
