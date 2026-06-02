import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let patch: WidgetPatch;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await dashboardStore.updateWidget(params.id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updateWidget failed:", err);
    return NextResponse.json({ error: "Could not update widget" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await dashboardStore.deleteWidget(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteWidget failed:", err);
    return NextResponse.json({ error: "Could not delete widget" }, { status: 502 });
  }
}
