import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { NotFoundError, ValidationError } from "@/lib/integrations/ulink-agent/errors";
import { parseWidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let patch;
  try {
    patch = parseWidgetPatch(raw);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  try {
    await dashboardStore.updateWidget(params.id, patch, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }
    console.error("updateWidget failed:", err);
    return NextResponse.json({ error: "Could not update widget" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await dashboardStore.deleteWidget(params.id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }
    console.error("deleteWidget failed:", err);
    return NextResponse.json({ error: "Could not delete widget" }, { status: 502 });
  }
}
