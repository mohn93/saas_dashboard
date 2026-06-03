import { NextRequest, NextResponse } from "next/server";
import { conversationStore } from "@/lib/integrations/ulink-agent/conversations";
import { NotFoundError } from "@/lib/integrations/ulink-agent/errors";
import { getSessionEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await conversationStore.getConversation(params.id, email);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    console.error("getConversation failed:", err);
    return NextResponse.json({ error: "Could not load conversation" }, { status: 502 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const email = await getSessionEmail(request);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await conversationStore.deleteConversation(params.id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    console.error("deleteConversation failed:", err);
    return NextResponse.json({ error: "Could not delete conversation" }, { status: 502 });
  }
}
