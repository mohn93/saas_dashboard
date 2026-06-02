"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Pencil, Check, ArrowLeft } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DashboardGrid } from "@/components/dashboard-builder/dashboard-grid";
import { AddWidgetComposer } from "@/components/dashboard-builder/add-widget-composer";
import type { ChartSpec, QueryResult } from "@/lib/integrations/ulink-agent/types";

export default function DashboardDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const {
    dashboard,
    widgets,
    loading,
    notFound,
    refreshWidget,
    refreshAll,
    addWidget,
    updateWidget,
    removeWidget,
    reorder,
    rename,
  } = useDashboard(params.id);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (notFound) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => router.push("/dashboards")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to dashboards
        </button>
        <p className="text-sm text-muted-foreground">This dashboard doesn&apos;t exist.</p>
      </div>
    );
  }

  function onEditQuery(id: string) {
    const w = widgets.find((x) => x.id === id);
    if (!w) return;
    const next = window.prompt("Re-ask the agent for this widget:", w.question ?? "");
    if (next === null || !next.trim()) return;
    // Re-run via the compose endpoint, then patch the widget with the new query + result.
    void (async () => {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: next.trim(), history: [], persist: false }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sql: string | null = null;
      let chart: ChartSpec | null = null;
      let result: QueryResult | null = null;
      const consume = (line: string) => {
        const t = line.trim();
        if (!t) return;
        try {
          const e = JSON.parse(t) as { type: string; [k: string]: unknown };
          if (e.type === "sql") sql = e.sql as string;
          if (e.type === "result") {
            result = { columns: e.columns, rows: e.rows, rowCount: e.rowCount } as QueryResult;
            chart = (e.chart ?? null) as ChartSpec | null;
          }
        } catch {
          /* skip */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) consume(l);
      }
      consume(buffer);
      // A failed or chat-path re-ask yields no query/result — never blank a working widget.
      if (sql === null || result === null) {
        window.alert("The agent didn't return a query for that question — the widget was left unchanged.");
        return;
      }
      await updateWidget(id, { question: next.trim(), sql, chart, result });
    })();
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.push("/dashboards")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboards
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <input
            value={nameDraft ?? dashboard?.name ?? ""}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft !== null && nameDraft.trim() && nameDraft !== dashboard?.name) {
                void rename(nameDraft.trim());
              }
              setNameDraft(null);
            }}
            className="rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xl font-bold outline-none focus:border-violet-500"
          />
        ) : (
          <h1 className="text-2xl font-bold tracking-tight">{dashboard?.name ?? "…"}</h1>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" /> Refresh all
          </button>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 text-sm hover:bg-accent"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {loading && widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DashboardGrid
          widgets={widgets}
          editing={editing}
          onReorder={reorder}
          onRefreshWidget={refreshWidget}
          onPatchWidget={updateWidget}
          onRemoveWidget={removeWidget}
          onEditQuery={onEditQuery}
        >
          <AddWidgetComposer onAdd={addWidget} />
        </DashboardGrid>
      )}
    </div>
  );
}
