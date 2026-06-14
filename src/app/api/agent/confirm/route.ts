import { NextRequest } from "next/server";
import { getFastClient } from "@/lib/integrations/ulink-agent/llm";
import { supabaseMemory } from "@/lib/integrations/ulink-agent/memory";
import { conversationStore, persistTurn } from "@/lib/integrations/ulink-agent/conversations";
import { executeReadOnly } from "@/lib/integrations/ulink-agent/client";
import { validateSelect } from "@/lib/integrations/ulink-agent/validate";
import { takePending } from "@/lib/integrations/ulink-agent/pending";
import { narrateResult } from "@/lib/integrations/ulink-agent/narrate";
import { getSessionEmail } from "@/lib/auth/session";
import type { AgentEvent } from "@/lib/integrations/ulink-agent/events";
import type { QueryResult } from "@/lib/integrations/ulink-agent/types";

export const dynamic = "force-dynamic";
// No R1 loop here — just one read-only query + a single fast narration call.
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "token is required" }), { status: 400 });
  }

  const userEmail = await getSessionEmail(request);
  if (!userEmail) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const pending = await takePending(token, userEmail);
  if (!pending) {
    return new Response(
      JSON.stringify({ error: "This confirmation has expired. Please ask again." }),
      { status: 410 }
    );
  }

  // Re-validate the raw SQL before executing. The user has accepted the cost, so
  // we do not re-gate — read-only validation + the pm_readonly role + the
  // statement timeout remain the safety backstops.
  const v = validateSelect(pending.rawSql);
  if (!v.ok) {
    return new Response(JSON.stringify({ error: v.error ?? "Invalid SQL" }), { status: 400 });
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
        emit({ type: "sql", sql: pending.rawSql });
        emit({ type: "phase", phase: "running" });

        let result: QueryResult;
        try {
          // Execute the exact SQL the user approved (validated + wrapped at stash time); the re-validate above is just a safety gate.
          result = await executeReadOnly(pending.wrappedSql);
        } catch (err) {
          const error = err instanceof Error ? err.message : "Query failed";
          await supabaseMemory.insertQueryLog({
            question: pending.question,
            sql: pending.rawSql,
            attempts: 1,
            rowCount: null,
            success: false,
            error,
            userEmail,
            estCost: pending.estCost,
            estRows: pending.estRows,
          });
          emit({ type: "error", error });
          emit({ type: "phase", phase: "error" });
          return;
        }

        emit({
          type: "result",
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          chart: pending.chart,
          display: pending.display,
        });

        // The user already has their data (result emitted above); a logging
        // failure must not abort the stream.
        let logId: string | null = null;
        try {
          logId = await supabaseMemory.insertQueryLog({
            question: pending.question,
            sql: pending.rawSql,
            attempts: 1,
            rowCount: result.rowCount,
            success: true,
            error: null,
            userEmail,
            estCost: pending.estCost,
            estRows: pending.estRows,
          });
        } catch (logErr) {
          console.error("Insert confirmed query log failed:", logErr);
          logId = null;
        }

        try {
          await narrateResult(getFastClient(), pending.question, result, (delta) =>
            emit({ type: "narration", delta })
          );
        } catch {
          emit({ type: "narration", delta: "Here are the results." });
        }

        emit({ type: "phase", phase: "done" });
        emit({ type: "done", logId });

        try {
          const { conversationId: id, title } = await persistTurn(conversationStore, {
            question: pending.question,
            conversationId: pending.conversationId,
            userEmail,
            events: collected,
          });
          emit({ type: "conversation", conversationId: id, title });
        } catch (persistErr) {
          console.error("Persist confirmed turn failed:", persistErr);
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
