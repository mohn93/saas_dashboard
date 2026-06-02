import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { answerQuestion } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";

export const dynamic = "force-dynamic";
// deepseek-reasoner (R1) is slow (~10-30s) and the loop may make several calls
// (table-select + up to 3 SQL attempts). Allow up to 60s so Vercel doesn't time
// out mid-query. Raise (Pro/Fluid supports up to 300) if heavy queries still hit it.
export const maxDuration = 60;

async function getUserEmail(request: NextRequest): Promise<string | null> {
  const session = request.cookies.get("fw_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const history = Array.isArray(body.history)
    ? (body.history as ConversationTurn[]).slice(-5)
    : [];

  const userEmail = await getUserEmail(request);

  try {
    const answer = await answerQuestion(
      { question: body.question, userEmail, history },
      { llm: getDeepSeekClient(), memory: supabaseMemory, execute: executeReadOnly }
    );
    return NextResponse.json(answer);
  } catch (err) {
    console.error("Agent query failed:", err);
    return NextResponse.json(
      { error: "Agent failed to process the question" },
      { status: 502 }
    );
  }
}
