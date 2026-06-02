import { getULinkClient } from "@/lib/integrations/ulink/client";
import { executeReadOnly } from "./client";
import { validateSelect } from "./validate";
import { capRows } from "./widgets";
import type { WidgetCreateInput, WidgetPatch } from "./widgets";
import type {
  ChartSpec,
  DashboardSummary,
  QueryResult,
  Widget,
} from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

export interface DashboardStore {
  listDashboards(): Promise<DashboardSummary[]>;
  createDashboard(input: { name: string; userEmail: string | null }): Promise<{ id: string }>;
  getDashboard(id: string): Promise<{ dashboard: DashboardSummary; widgets: Widget[] }>;
  renameDashboard(id: string, name: string): Promise<void>;
  deleteDashboard(id: string): Promise<void>;
  createWidget(dashboardId: string, input: WidgetCreateInput): Promise<{ id: string }>;
  updateWidget(id: string, patch: WidgetPatch): Promise<void>;
  deleteWidget(id: string): Promise<void>;
  reorderWidgets(positions: Record<string, number>): Promise<void>;
  refreshWidget(id: string): Promise<QueryResult>;
}

function toDashboardSummary(r: Record<string, unknown>): DashboardSummary {
  const widgetsAgg = r.widgets as { count: number }[] | undefined;
  return {
    id: r.id as string,
    name: r.name as string,
    widgetCount: widgetsAgg?.[0]?.count ?? 0,
    createdByEmail: (r.created_by_email as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

function toWidget(r: Record<string, unknown>): Widget {
  return {
    id: r.id as string,
    dashboardId: r.dashboard_id as string,
    kind: r.kind as Widget["kind"],
    title: r.title as string,
    position: r.position as number,
    size: r.size as Widget["size"],
    question: (r.question as string | null) ?? null,
    sql: (r.sql as string | null) ?? null,
    chart: (r.chart_spec as ChartSpec | null) ?? null,
    result: (r.cached_result as QueryResult | null) ?? null,
    cachedAt: (r.cached_at as string | null) ?? null,
    textMd: (r.text_md as string | null) ?? null,
    createdByEmail: (r.created_by_email as string | null) ?? null,
  };
}

export const dashboardStore: DashboardStore = {
  async listDashboards() {
    const { data, error } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`listDashboards: ${error.message}`);
    return (data ?? []).map((r) => toDashboardSummary(r as Record<string, unknown>));
  },

  async createDashboard({ name, userEmail }) {
    const { data, error } = await db()
      .from("dashboards")
      .insert({ name, created_by_email: userEmail })
      .select("id")
      .single();
    if (error) throw new Error(`createDashboard: ${error.message}`);
    return { id: data!.id as string };
  },

  async getDashboard(id) {
    const { data: dash, error: dErr } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .eq("id", id)
      .single();
    if (dErr) throw new Error(`getDashboard(dashboard): ${dErr.message}`);
    const { data: rows, error: wErr } = await db()
      .from("widgets")
      .select(
        "id, dashboard_id, kind, title, position, size, question, sql, chart_spec, cached_result, cached_at, text_md, created_by_email"
      )
      .eq("dashboard_id", id)
      .order("position", { ascending: true });
    if (wErr) throw new Error(`getDashboard(widgets): ${wErr.message}`);
    return {
      dashboard: toDashboardSummary(dash as Record<string, unknown>),
      widgets: (rows ?? []).map((r) => toWidget(r as Record<string, unknown>)),
    };
  },

  async renameDashboard(id, name) {
    const { error } = await db().from("dashboards").update({ name }).eq("id", id);
    if (error) throw new Error(`renameDashboard: ${error.message}`);
  },

  async deleteDashboard(id) {
    const { error } = await db().from("dashboards").delete().eq("id", id);
    if (error) throw new Error(`deleteDashboard: ${error.message}`);
  },

  async createWidget(dashboardId, input) {
    // position defaults to current max + 1
    const { data: last, error: pErr } = await db()
      .from("widgets")
      .select("position")
      .eq("dashboard_id", dashboardId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pErr) throw new Error(`createWidget(position): ${pErr.message}`);
    const position = ((last?.position as number | undefined) ?? -1) + 1;
    const hasResult = input.result != null;
    const { data, error } = await db()
      .from("widgets")
      .insert({
        dashboard_id: dashboardId,
        kind: input.kind,
        title: input.title,
        position,
        size: input.size,
        question: input.question,
        sql: input.sql,
        chart_spec: input.chart,
        cached_result: input.result,
        cached_at: hasResult ? new Date().toISOString() : null,
        text_md: input.textMd,
      })
      .select("id")
      .single();
    if (error) throw new Error(`createWidget(insert): ${error.message}`);
    return { id: data!.id as string };
  },

  async updateWidget(id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.size !== undefined) row.size = patch.size;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.chart !== undefined) row.chart_spec = patch.chart;
    if (patch.textMd !== undefined) row.text_md = patch.textMd;
    if (patch.position !== undefined) row.position = patch.position;
    if (patch.question !== undefined) row.question = patch.question;
    if (patch.sql !== undefined) row.sql = patch.sql;
    if (patch.result !== undefined) {
      row.cached_result = patch.result;
      row.cached_at = patch.result ? new Date().toISOString() : null;
    }
    const { error } = await db().from("widgets").update(row).eq("id", id);
    if (error) throw new Error(`updateWidget: ${error.message}`);
  },

  async deleteWidget(id) {
    const { error } = await db().from("widgets").delete().eq("id", id);
    if (error) throw new Error(`deleteWidget: ${error.message}`);
  },

  async reorderWidgets(positions) {
    const entries = Object.entries(positions);
    await Promise.all(
      entries.map(([id, position]) =>
        db()
          .from("widgets")
          .update({ position })
          .eq("id", id)
          .then(({ error }) => {
            if (error) throw new Error(`reorderWidgets(${id}): ${error.message}`);
          })
      )
    );
  },

  async refreshWidget(id) {
    const { data: w, error } = await db()
      .from("widgets")
      .select("sql")
      .eq("id", id)
      .single();
    if (error) throw new Error(`refreshWidget(load): ${error.message}`);
    const sql = w?.sql as string | null;
    if (!sql) throw new Error("refreshWidget: widget has no SQL to run");

    const v = validateSelect(sql, 1000);
    if (!v.ok) throw new Error(`refreshWidget(validate): ${v.error}`);
    const fresh = await executeReadOnly(v.sql);
    const capped = capRows(fresh)!;

    const { error: uErr } = await db()
      .from("widgets")
      .update({ cached_result: capped, cached_at: new Date().toISOString() })
      .eq("id", id);
    if (uErr) throw new Error(`refreshWidget(save): ${uErr.message}`);
    return capped;
  },
};
