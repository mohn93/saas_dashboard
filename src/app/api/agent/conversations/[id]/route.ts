import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/integrations/ulink-agent/conversations";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await conversationStore.getConversation(params.id);
    return NextResponse.json(data);
  } catch (err) {
    console.error("getConversation failed:", err);
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await conversationStore.deleteConversation(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteConversation failed:", err);
    return NextResponse.json({ error: "Could not delete conversation" }, { status: 502 });
  }
}
