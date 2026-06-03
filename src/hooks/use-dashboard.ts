"use client";

import { useCallback, useEffect, useState } from "react";
import { applyReorder, isStale } from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetCreateInput, WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type {
  DashboardSummary,
  QueryResult,
  Widget,
} from "@/lib/integrations/ulink-agent/types";

export function useDashboard(id: string) {
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const setWidget = useCallback((wid: string, fn: (w: Widget) => Widget) => {
    setWidgets((prev) => prev.map((w) => (w.id === wid ? fn(w) : w)));
  }, []);

  const refreshWidget = useCallback(
    async (wid: string) => {
      try {
        const res = await fetch(`/api/agent/widgets/${wid}/refresh`, { method: "POST" });
        if (!res.ok) {
          setWidget(wid, (w) => ({ ...w, refreshError: true }));
          return;
        }
        const data = (await res.json()) as { result: QueryResult };
        setWidget(wid, (w) => ({
          ...w,
          result: data.result,
          cachedAt: new Date().toISOString(),
          refreshError: false,
        }));
      } catch {
        setWidget(wid, (w) => ({ ...w, refreshError: true }));
      }
    },
    [setWidget]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/dashboards/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as { dashboard: DashboardSummary; widgets: Widget[] };
      setDashboard(data.dashboard);
      setWidgets(data.widgets);
      // Auto-refresh stale query widgets in the background (no spinner).
      const now = Date.now();
      data.widgets
        .filter((w) => w.kind !== "text" && w.sql && isStale(w.cachedAt, now))
        .forEach((w) => void refreshWidget(w.id));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, refreshWidget]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAll = useCallback(() => {
    widgets
      .filter((w) => w.kind !== "text" && w.sql)
      .forEach((w) => void refreshWidget(w.id));
  }, [widgets, refreshWidget]);

  const addWidget = useCallback(
    async (input: WidgetCreateInput) => {
      const res = await fetch(`/api/agent/dashboards/${id}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) await load();
    },
    [id, load]
  );

  const updateWidget = useCallback(
    async (wid: string, patch: WidgetPatch) => {
      setWidget(wid, (w) => ({
        ...w,
        ...patch,
        // mirror the store: a fresh result resets the cache stamp + error flag
        ...(patch.result !== undefined
          ? { cachedAt: new Date().toISOString(), refreshError: false }
          : {}),
      } as Widget)); // optimistic
      try {
        const res = await fetch(`/api/agent/widgets/${wid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) void load(); // server rejected the edit — resync from source
      } catch {
        void load();
      }
    },
    [setWidget, load]
  );

  const removeWidget = useCallback(
    async (wid: string) => {
      setWidgets((prev) => prev.filter((w) => w.id !== wid)); // optimistic
      try {
        const res = await fetch(`/api/agent/widgets/${wid}`, { method: "DELETE" });
        if (!res.ok) void load();
      } catch {
        void load();
      }
    },
    [load]
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      const positions = applyReorder(orderedIds);
      setWidgets((prev) =>
        [...prev].sort((a, b) => (positions[a.id] ?? 0) - (positions[b.id] ?? 0))
      ); // optimistic
      try {
        const res = await fetch(`/api/agent/dashboards/${id}/reorder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions }),
        });
        if (!res.ok) void load();
      } catch {
        void load();
      }
    },
    [id, load]
  );

  const rename = useCallback(
    async (name: string) => {
      setDashboard((d) => (d ? { ...d, name } : d)); // optimistic
      try {
        const res = await fetch(`/api/agent/dashboards/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) void load();
      } catch {
        void load();
      }
    },
    [id, load]
  );

  return {
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
  };
}
