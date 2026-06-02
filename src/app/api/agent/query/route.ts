import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { runAgent } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient, getFastClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";

export const dynamic = "force-dynamic";
// R1 is slow; the loop may make several calls. Allow up to 60s (raise on Pro/Fluid).
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
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  if (typeof body.question !== "string" || !body.question.trim()) {
    return new Response(JSON.stringify({ error: "question is required" }), { status: 400 });
  }
  const question = body.question;
  const history = Array.isArray(body.history)
    ? (body.history as ConversationTurn[]).slice(-5)
    : [];
  const userEmail = await getUserEmail(request);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(
          { question, userEmail, history },
          {
            reasoner: getDeepSeekClient(),
            fast: getFastClient(),
            memory: supabaseMemory,
            execute: executeReadOnly,
          },
          emit
        );
      } catch (err) {
        emit({
          type: "error",
          error: err instanceof Error ? err.message : "Agent failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
