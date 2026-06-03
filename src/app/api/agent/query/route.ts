import { NextRequest } from "next/server";
import { runAgent } from "@/lib/integrations/ulink-agent/loop";
import { getDeepSeekClient, getFastClient, getPlannerClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { conversationStore, persistTurn } from "@/lib/integrations/ulink-agent/conversations";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import { getSessionEmail } from "@/lib/auth/session";
import type { ConversationTurn } from "@/lib/integrations/ulink-agent/types";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";

export const dynamic = "force-dynamic";
// R1 is slow; the loop may make several calls. Allow up to 60s (raise on Pro/Fluid).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { question?: unknown; history?: unknown; conversationId?: unknown; persist?: unknown };
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
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const persist = body.persist !== false; // default true; the dashboard composer sends false
  const userEmail = await getSessionEmail(request);

  if (!userEmail) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const collected: AgentEvent[] = [];
      const emit = (e: AgentEvent) => {
        collected.push(e);
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        try {
          await runAgent(
            { question, userEmail, history },
            {
              reasoner: getDeepSeekClient(),
              fast: getFastClient(),
              planner: getPlannerClient(),
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
        }

        // Persist the turn (best-effort: never break the answer if storage fails).
        // The dashboard composer streams with persist:false — it composes a widget and
        // must not create a conversation.
        if (persist) {
          try {
            const { conversationId: id, title } = await persistTurn(conversationStore, {
              question,
              conversationId,
              userEmail,
              events: collected,
            });
            emit({ type: "conversation", conversationId: id, title });
          } catch (persistErr) {
            console.error("Persist turn failed:", persistErr);
          }
        }
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
