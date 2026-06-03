import { getULinkClient } from "@/lib/integrations/ulink/client";
import { executeReadOnly } from "./client";
import { NotFoundError } from "./errors";
import { validateSelect } from "./validate";
import { capRows } from "./widgets";
import type { WidgetCreateInput, WidgetPatch } from "./widgets";
import type {
  ChartSpec,
  DashboardSummary,
  DisplayMode,
  QueryResult,
  Widget,
} from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

// Every method below runs under the service-role client (bypasses RLS), so
// authorization is enforced here in code: list/read/mutate are scoped to the
// authenticated user's own rows, and widget operations are authorized through
// the owning dashboard (a widget's own created_by_email is historically
// nullable and not trustworthy). A missing OR not-owned row throws
// NotFoundError, which routes map to 404 (so ownership can't be probed).
export interface DashboardStore {
  listDashboards(userEmail: string): Promise<DashboardSummary[]>;
  createDashboard(input: { name: string; userEmail: string | null }): Promise<{ id: string }>;
  getDashboard(
    id: string,
    userEmail: string
  ): Promise<{ dashboard: DashboardSummary; widgets: Widget[] }>;
  renameDashboard(id: string, name: string, userEmail: string): Promise<void>;
  deleteDashboard(id: string, userEmail: string): Promise<void>;
  createWidget(
    dashboardId: string,
    input: WidgetCreateInput,
    userEmail: string
  ): Promise<{ id: string }>;
  updateWidget(id: string, patch: WidgetPatch, userEmail: string): Promise<void>;
  deleteWidget(id: string, userEmail: string): Promise<void>;
  reorderWidgets(
    dashboardId: string,
    positions: Record<string, number>,
    userEmail: string
  ): Promise<void>;
  refreshWidget(id: string, userEmail: string): Promise<QueryResult>;
}

// Throws NotFoundError unless `userEmail` owns dashboard `id`.
async function assertDashboardOwner(id: string, userEmail: string): Promise<void> {
  const { data, error } = await db()
    .from("dashboards")
    .select("id")
    .eq("id", id)
    .eq("created_by_email", userEmail)
    .maybeSingle();
  if (error) throw new Error(`assertDashboardOwner: ${error.message}`);
  if (!data) throw new NotFoundError("Dashboard not found");
}

// Throws NotFoundError unless `userEmail` owns the dashboard that widget `id`
// belongs to (authorized through the FK, not the widget's own column).
async function assertWidgetOwner(id: string, userEmail: string): Promise<void> {
  const { data, error } = await db()
    .from("widgets")
    .select("id, dashboards!inner(created_by_email)")
    .eq("id", id)
    .eq("dashboards.created_by_email", userEmail)
    .maybeSingle();
  if (error) throw new Error(`assertWidgetOwner: ${error.message}`);
  if (!data) throw new NotFoundError("Widget not found");
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
    display: (r.display as DisplayMode | null) ?? "both",
    result: (r.cached_result as QueryResult | null) ?? null,
    cachedAt: (r.cached_at as string | null) ?? null,
    textMd: (r.text_md as string | null) ?? null,
    createdByEmail: (r.created_by_email as string | null) ?? null,
  };
}

export const dashboardStore: DashboardStore = {
  async listDashboards(userEmail) {
    const { data, error } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .eq("created_by_email", userEmail)
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

  async getDashboard(id, userEmail) {
    const { data: dash, error: dErr } = await db()
      .from("dashboards")
      .select("id, name, created_by_email, updated_at, widgets(count)")
      .eq("id", id)
      .eq("created_by_email", userEmail)
      .maybeSingle();
    if (dErr) throw new Error(`getDashboard(dashboard): ${dErr.message}`);
    if (!dash) throw new NotFoundError("Dashboard not found");
    const { data: rows, error: wErr } = await db()
      .from("widgets")
      .select(
        "id, dashboard_id, kind, title, position, size, display, question, sql, chart_spec, cached_result, cached_at, text_md, created_by_email"
      )
      .eq("dashboard_id", id)
      .order("position", { ascending: true });
    if (wErr) throw new Error(`getDashboard(widgets): ${wErr.message}`);
    return {
      dashboard: toDashboardSummary(dash as Record<string, unknown>),
      widgets: (rows ?? []).map((r) => toWidget(r as Record<string, unknown>)),
    };
  },

  async renameDashboard(id, name, userEmail) {
    const { data, error } = await db()
      .from("dashboards")
      .update({ name })
      .eq("id", id)
      .eq("created_by_email", userEmail)
      .select("id");
    if (error) throw new Error(`renameDashboard: ${error.message}`);
    if (!data || data.length === 0) throw new NotFoundError("Dashboard not found");
  },

  async deleteDashboard(id, userEmail) {
    const { data, error } = await db()
      .from("dashboards")
      .delete()
      .eq("id", id)
      .eq("created_by_email", userEmail)
      .select("id");
    if (error) throw new Error(`deleteDashboard: ${error.message}`);
    if (!data || data.length === 0) throw new NotFoundError("Dashboard not found");
  },

  async createWidget(dashboardId, input, userEmail) {
    await assertDashboardOwner(dashboardId, userEmail);
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
        display: input.display,
        question: input.question,
        sql: input.sql,
        chart_spec: input.chart,
        cached_result: input.result,
        cached_at: hasResult ? new Date().toISOString() : null,
        text_md: input.textMd,
        created_by_email: userEmail,
      })
      .select("id")
      .single();
    if (error) throw new Error(`createWidget(insert): ${error.message}`);
    return { id: data!.id as string };
  },

  async updateWidget(id, patch, userEmail) {
    await assertWidgetOwner(id, userEmail);
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.size !== undefined) row.size = patch.size;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.display !== undefined) row.display = patch.display;
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

  async deleteWidget(id, userEmail) {
    await assertWidgetOwner(id, userEmail);
    const { error } = await db().from("widgets").delete().eq("id", id);
    if (error) throw new Error(`deleteWidget: ${error.message}`);
  },

  async reorderWidgets(dashboardId, positions, userEmail) {
    await assertDashboardOwner(dashboardId, userEmail);
    const entries = Object.entries(positions);
    await Promise.all(
      entries.map(([id, position]) =>
        db()
          .from("widgets")
          .update({ position })
          .eq("id", id)
          .eq("dashboard_id", dashboardId)
          .then(({ error }) => {
            if (error) throw new Error(`reorderWidgets(${id}): ${error.message}`);
          })
      )
    );
  },

  async refreshWidget(id, userEmail) {
    await assertWidgetOwner(id, userEmail);
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
