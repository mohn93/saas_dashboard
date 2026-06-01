import { NextResponse } from "next/server";
import { introspectAndStore } from "@/lib/integrations/ulink-agent/introspect";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const counts = await introspectAndStore();
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    console.error("Schema refresh failed:", err);
    return NextResponse.json({ error: "Schema refresh failed" }, { status: 502 });
  }
}
