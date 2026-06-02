"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { LayoutDashboard, Plus, Check } from "lucide-react";
import { useDashboards } from "@/hooks/use-dashboards";
import { widgetFromAnswer } from "@/lib/integrations/ulink-agent/widgets";
import type { AgentMessage } from "@/lib/integrations/ulink-agent/message";

export function PinToDashboard({ message }: { message: AgentMessage }) {
  const { dashboards, create, refresh } = useDashboards({ auto: false });
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pin(dashboardId: string) {
    setBusy(true);
    const input = widgetFromAnswer({
      question: message.question,
      sql: message.sql,
      chart: message.chart,
      result: message.result,
    });
    try {
      const res = await fetch(`/api/agent/dashboards/${dashboardId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) setSavedTo(dashboardId);
    } finally {
      setBusy(false);
    }
  }

  async function pinToNew() {
    if (!newName.trim()) return;
    setBusy(true);
    const id = await create(newName.trim());
    setNewName("");
    if (id) await pin(id);
    else setBusy(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void refresh();
        else setSavedTo(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LayoutDashboard className="h-4 w-4" /> Add to dashboard
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-border/50 bg-card p-2 shadow-lg"
        >
          {savedTo ? (
            <div className="space-y-2 p-2 text-sm">
              <div className="flex items-center gap-2 text-green-400">
                <Check className="h-4 w-4" /> Added
              </div>
              <Link
                href={`/dashboards/${savedTo}`}
                className="block text-violet-400 hover:text-violet-300"
              >
                View dashboard →
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Pin to…</p>
              <div className="max-h-48 overflow-y-auto">
                {dashboards.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void pin(d.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 text-violet-400" />
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 border-t border-border/50 pt-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New dashboard…"
                  className="flex-1 rounded-md border border-border/50 bg-background px-2 py-1 text-sm outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  disabled={busy || !newName.trim()}
                  onClick={() => void pinToNew()}
                  className="rounded-md p-1.5 text-violet-400 hover:bg-accent disabled:opacity-50"
                  aria-label="Create and pin"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
