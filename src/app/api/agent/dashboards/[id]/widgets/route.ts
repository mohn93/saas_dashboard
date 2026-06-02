import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";
import type { WidgetCreateInput } from "@/lib/integrations/ulink-agent/widgets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Partial<WidgetCreateInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.kind || !body.title || !body.size) {
    return NextResponse.json({ error: "kind, title, and size are required" }, { status: 400 });
  }
  const input: WidgetCreateInput = {
    kind: body.kind,
    title: body.title,
    size: body.size,
    question: body.question ?? null,
    sql: body.sql ?? null,
    chart: body.chart ?? null,
    result: body.result ?? null,
    textMd: body.textMd ?? null,
  };
  try {
    const { id } = await dashboardStore.createWidget(params.id, input);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("createWidget failed:", err);
    return NextResponse.json({ error: "Could not create widget" }, { status: 502 });
  }
}
