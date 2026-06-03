import { NextRequest, NextResponse } from "next/server";
import { dashboardStore } from "@/lib/integrations/ulink-agent/dashboards";
import { NotFoundError } from "@/lib/integrations/ulink-agent/errors";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await dashboardStore.refreshWidget(params.id, email);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }
    console.error("refreshWidget failed:", err);
    return NextResponse.json({ error: "Could not refresh widget" }, { status: 502 });
  }
}
