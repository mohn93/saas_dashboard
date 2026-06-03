import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { NotFoundError } from "@/lib/integrations/ulink-agent/errors";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await dashboardStore.getDashboard(params.id, email);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("getDashboard failed:", err);
    return NextResponse.json({ error: "Could not load dashboard" }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    await dashboardStore.renameDashboard(params.id, body.name.trim(), email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("renameDashboard failed:", err);
    return NextResponse.json({ error: "Could not rename dashboard" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await dashboardStore.deleteDashboard(params.id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("deleteDashboard failed:", err);
    return NextResponse.json({ error: "Could not delete dashboard" }, { status: 502 });
  }
}
