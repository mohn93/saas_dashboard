import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { NotFoundError, ValidationError } from "@/lib/integrations/ulink-agent/errors";
import { parseWidgetCreate } from "@/lib/integrations/ulink-agent/widgets";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let input;
  try {
    input = parseWidgetCreate(raw);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  try {
    const { id } = await dashboardStore.createWidget(params.id, input, email);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("createWidget failed:", err);
    return NextResponse.json({ error: "Could not create widget" }, { status: 502 });
  }
}
