"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardSummary } from "@/lib/integrations/ulink-agent/types";

export function useDashboards({ auto = true }: { auto?: boolean } = {}) {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/dashboards");
      if (!res.ok) return;
      const data = (await res.json()) as { dashboards: DashboardSummary[] };
      setDashboards(data.dashboards ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const res = await fetch("/api/agent/dashboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id: string };
        void refresh();
        return data.id;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setDashboards((prev) => prev.filter((d) => d.id !== id)); // optimistic
      try {
        await fetch(`/api/agent/dashboards/${id}`, { method: "DELETE" });
      } catch {
        void refresh();
      }
    },
    [refresh]
  );

  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return { dashboards, refresh, create, remove };
}
