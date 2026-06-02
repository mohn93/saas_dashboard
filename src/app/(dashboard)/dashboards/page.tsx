"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plus, Trash2, LayoutDashboard } from "lucide-react";
import { useDashboards } from "@/hooks/use-dashboards";

export default function DashboardsPage() {
  const { dashboards, create, remove } = useDashboards();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    await create(name.trim());
    setName("");
    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
          <p className="text-muted-foreground">Compose views from PM Data Agent results. Shared across the team.</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New dashboard name…"
          className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> New dashboard
        </button>
      </form>

      {dashboards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No dashboards yet. Create one above, or pin an answer from the PM Agent.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <div key={d.id} className="group relative rounded-lg border border-border/50 bg-card p-4 transition-shadow hover:shadow-md">
              <Link href={`/dashboards/${d.id}`} className="block">
                <div className="mb-2 flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4 text-violet-400" />
                  <h3 className="truncate font-semibold">{d.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.widgetCount} widget{d.widgetCount === 1 ? "" : "s"} · updated{" "}
                  {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
                </p>
                {d.createdByEmail && (
                  <p className="mt-1 text-xs text-muted-foreground/60">{d.createdByEmail}</p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => void remove(d.id)}
                className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-red-400 group-hover:opacity-100"
                aria-label="Delete dashboard"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
