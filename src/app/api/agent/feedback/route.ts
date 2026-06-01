import { NextRequest, NextResponse } from "next/server";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { logId?: unknown; helpful?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.logId !== "string" || typeof body.helpful !== "boolean") {
    return NextResponse.json(
      { error: "logId (string) and helpful (boolean) are required" },
      { status: 400 }
    );
  }

  // Only thumbs-up promotes a query into a trusted example.
  if (!body.helpful) {
    return NextResponse.json({ ok: true, promoted: false });
  }

  try {
    await supabaseMemory.promoteLogToExample(body.logId);
    return NextResponse.json({ ok: true, promoted: true });
  } catch (err) {
    console.error("Feedback promote failed:", err);
    return NextResponse.json({ error: "Could not record feedback" }, { status: 502 });
  }
}
