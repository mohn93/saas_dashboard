import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dashboards = await dashboardStore.listDashboards();
    return NextResponse.json({ dashboards });
  } catch (err) {
    console.error("listDashboards failed:", err);
    return NextResponse.json({ error: "Could not list dashboards" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled dashboard";
  try {
    const { id } = await dashboardStore.createDashboard({ name, userEmail: email });
    return NextResponse.json({ id });
  } catch (err) {
    console.error("createDashboard failed:", err);
    return NextResponse.json({ error: "Could not create dashboard" }, { status: 502 });
  }
}
