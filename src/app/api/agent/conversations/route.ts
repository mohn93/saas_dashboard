import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/integrations/ulink-agent/conversations";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const conversations = await conversationStore.listConversations(email);
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("listConversations failed:", err);
    return NextResponse.json({ error: "Could not list conversations" }, { status: 502 });
  }
}
