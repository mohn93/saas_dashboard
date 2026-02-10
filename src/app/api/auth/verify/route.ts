import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export async function GET(request: NextRequest) {
  const session = request.cookies.get("fw_session")?.value;

  if (!session) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return NextResponse.json({ uid: decoded.uid });
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }
}
