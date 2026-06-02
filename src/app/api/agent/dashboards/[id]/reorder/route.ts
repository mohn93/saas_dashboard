import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { positions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const positions = body.positions;
  if (typeof positions !== "object" || positions === null) {
    return NextResponse.json({ error: "positions object is required" }, { status: 400 });
  }
  try {
    await dashboardStore.reorderWidgets(positions as Record<string, number>);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reorderWidgets failed:", err);
    return NextResponse.json({ error: "Could not reorder widgets" }, { status: 502 });
  }
}
