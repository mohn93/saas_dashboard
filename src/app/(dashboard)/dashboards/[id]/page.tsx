"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Pencil, Check, ArrowLeft } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DashboardGrid } from "@/components/dashboard-builder/dashboard-grid";
import { AddWidgetComposer } from "@/components/dashboard-builder/add-widget-composer";
import { EditQueryModal } from "@/components/dashboard-builder/edit-query-modal";
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
  // Edit-query modal: the widget being re-asked + its in-flight state.
  const [editTarget, setEditTarget] = useState<{ id: string; question: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    setEditError(null);
    setEditTarget({ id, question: w.question ?? "" });
  }

  async function runEditQuery(question: string) {
    if (!editTarget || !question.trim()) return;
    const { id } = editTarget;
    setEditBusy(true);
    setEditError(null);
    try {
      // Re-run via the compose endpoint, then patch the widget with the new query + result.
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), history: [], persist: false }),
      });
      if (!res.ok || !res.body) {
        setEditError("Couldn't reach the agent. Try again.");
        return;
      }
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
          // Guard the result shape: the optimistic widget update happens before
          // the server re-validates, so a malformed event must not store a
          // result whose .rows is missing (which would crash the table).
          if (
            e.type === "result" &&
            Array.isArray(e.columns) &&
            Array.isArray(e.rows) &&
            typeof e.rowCount === "number"
          ) {
            result = { columns: e.columns as string[], rows: e.rows as Record<string, unknown>[], rowCount: e.rowCount };
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
        setEditError("The agent didn't return a query for that question — the widget was left unchanged.");
        return;
      }
      await updateWidget(id, { question: question.trim(), sql, chart, result });
      setEditTarget(null);
    } catch {
      // Network/stream failure mid-flight — surface it instead of letting the
      // void-called promise reject unhandled and snap the modal back to idle.
      setEditError("The agent request failed. Try again.");
    } finally {
      setEditBusy(false);
    }
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

      {editTarget && (
        <EditQueryModal
          key={editTarget.id}
          initialQuestion={editTarget.question}
          busy={editBusy}
          error={editError}
          onCancel={() => {
            if (editBusy) return;
            setEditTarget(null);
            setEditError(null);
          }}
          onSubmit={(q) => void runEditQuery(q)}
        />
      )}
    </div>
  );
}
