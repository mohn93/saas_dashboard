import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { NotFoundError } from "@/lib/integrations/ulink-agent/errors";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { positions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = body.positions;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "positions object is required" }, { status: 400 });
  }
  // Validate every entry: widget id must be a UUID, position a finite integer.
  const positions: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `invalid widget id: ${id}` }, { status: 400 });
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return NextResponse.json({ error: `position for ${id} must be an integer` }, { status: 400 });
    }
    positions[id] = value;
  }
  try {
    await dashboardStore.reorderWidgets(params.id, positions, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("reorderWidgets failed:", err);
    return NextResponse.json({ error: "Could not reorder widgets" }, { status: 502 });
  }
}
