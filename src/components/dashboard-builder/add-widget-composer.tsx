"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles, Type, X, Loader2 } from "lucide-react";
import { useAgentCompose } from "@/hooks/use-agent-compose";
import { WidgetBody } from "./widget-body";
import {
  widgetFromAnswer,
  canChart,
  pickInitialKind,
  resolveWidgetChart,
} from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetCreateInput } from "@/lib/integrations/ulink-agent/widgets";
import { WidgetKindPicker } from "./widget-kind-picker";
import type { Widget, WidgetKind, WidgetSize, ChartType } from "@/lib/integrations/ulink-agent/types";

type Mode = "tile" | "menu" | "query" | "text";

export function AddWidgetComposer({ onAdd }: { onAdd: (input: WidgetCreateInput) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>("tile");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<WidgetSize>("md");
  const [textBody, setTextBody] = useState("");
  const [saving, setSaving] = useState(false);
  const { message, run, reset } = useAgentCompose();
  const [kind, setKind] = useState<WidgetKind>("table");
  const [chartType, setChartType] = useState<ChartType>("bar");

  useEffect(() => {
    if (message?.result) {
      setKind(pickInitialKind(message.result, message.chart, message.display));
      setChartType(message.chart && message.chart.type !== "none" ? message.chart.type : "bar");
    }
  }, [message?.result, message?.chart, message?.display]);

  const chartable =
    canChart(message?.result ?? null) ||
    !!(message?.chart && message.chart.xColumn && message.chart.yColumn);

  function close() {
    setMode("tile");
    setQuestion("");
    setTitle("");
    setTextBody("");
    setSize("md");
    setKind("table");
    setChartType("bar");
    reset();
  }

  async function addQueryWidget() {
    if (!message || message.loading || message.error || !message.result) return;
    setSaving(true);
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      result: message.result,
      title: title || message.question,
      size,
      kind,
      chart: resolveWidgetChart(message.result, message.chart, kind, chartType),
    });
    try {
      await onAdd(input);
      close();
    } finally {
      setSaving(false);
    }
  }

  async function addTextWidget() {
    if (!title.trim() && !textBody.trim()) return;
    setSaving(true);
    const input: WidgetCreateInput = {
      kind: "text",
      title: title.trim() || "Note",
      size,
      question: null,
      sql: null,
      chart: null,
      result: null,
      textMd: textBody,
    };
    try {
      await onAdd(input);
      close();
    } finally {
      setSaving(false);
    }
  }

  // Preview as a faux widget so it looks like it will on the dashboard.
  const previewWidget: Widget | null = message?.result
    ? {
        id: "preview",
        dashboardId: "",
        kind,
        title: title || message.question,
        position: 0,
        size,
        question: message.question,
        sql: message.sql,
        chart: resolveWidgetChart(message.result, message.chart, kind, chartType),
        result: message.result,
        cachedAt: null,
        textMd: null,
        createdByEmail: null,
      }
    : null;

  if (mode === "tile") {
    return (
      <button
        type="button"
        onClick={() => setMode("menu")}
        className="col-span-1 flex min-h-[160px] items-center justify-center rounded-lg border-2 border-dashed border-border/60 text-sm text-muted-foreground hover:border-violet-500/60 hover:text-foreground md:col-span-6"
      >
        <Plus className="mr-2 h-4 w-4" /> Add widget
      </button>
    );
  }

  return (
    <div className="col-span-1 rounded-lg border border-violet-500/40 bg-card p-4 md:col-span-12">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add a widget</h3>
        <button type="button" onClick={close} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode === "menu" && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode("query")}
            className="flex flex-1 items-center gap-2 rounded-lg border border-border/50 p-3 text-sm hover:bg-accent"
          >
            <Sparkles className="h-4 w-4 text-violet-400" /> Ask the agent
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className="flex flex-1 items-center gap-2 rounded-lg border border-border/50 p-3 text-sm hover:bg-accent"
          >
            <Type className="h-4 w-4" /> Text note
          </button>
        </div>
      )}

      {mode === "query" && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) void run(question.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. signups per week over the last 8 weeks"
              className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
            <button type="submit" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500">
              Run
            </button>
          </form>

          {message?.loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Working…
            </div>
          )}
          {message?.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{message.error}</div>
          )}
          {previewWidget && previewWidget.result && (
            <div className="rounded-lg border border-border/50 p-3">
              <WidgetBody widget={previewWidget} />
            </div>
          )}

          {message && !message.loading && !message.error && message.result && (
            <div className="space-y-2">
              <WidgetKindPicker
                kind={kind}
                chartType={chartType}
                chartable={chartable}
                onKindChange={setKind}
                onChartTypeChange={setChartType}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={message.question}
                  className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-1.5 text-sm outline-none focus:border-violet-500"
                />
                <SizePicker size={size} onChange={setSize} />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addQueryWidget()}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  Add to dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "text" && (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <textarea
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            placeholder="Write a note…"
            rows={3}
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <div className="flex items-center gap-2">
            <SizePicker size={size} onChange={setSize} />
            <button
              type="button"
              disabled={saving}
              onClick={() => void addTextWidget()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Add note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SizePicker({ size, onChange }: { size: WidgetSize; onChange: (s: WidgetSize) => void }) {
  const sizes: { k: WidgetSize; label: string }[] = [
    { k: "sm", label: "S" },
    { k: "md", label: "M" },
    { k: "full", label: "Full" },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-border/50 text-xs">
      {sizes.map((s) => (
        <button
          key={s.k}
          type="button"
          onClick={() => onChange(s.k)}
          className={size === s.k ? "bg-violet-600 px-2 py-1.5 text-white" : "px-2 py-1.5 hover:bg-accent"}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
