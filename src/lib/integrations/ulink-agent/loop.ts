import { TOOL_DEFS, dispatchTool, type ToolContext } from "./agent-tools";
import type { LLMClient, LLMToolMessage } from "./llm";
import type { AgentEvent } from "./events";
import type { ConversationTurn, MemoryStore, QueryResult, TableSummary } from "./types";

export interface AgentDeps {
  orchestrator: LLMClient; // V3, tool-calling
  reasoner: LLMClient; // R1, used by the query tool
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxSteps?: number;
}

export interface AgentInput {
  question: string;
  userEmail: string | null;
  conversationId?: string | null;
  history?: ConversationTurn[];
}

function buildSystemPrompt(tables: TableSummary[]): string {
  const tableList = tables
    .map((t) => `- ${t.table}${t.description ? `: ${t.description}` : ""}`)
    .join("\n");
  return [
    "You are the PM Data Agent for ULink. You answer questions about ULink's data by calling tools.",
    "Use the `query` tool to get data — it writes and runs read-only SQL for you; just ask a clear, " +
      "self-contained question in plain English. Use `clarify` to ask the user when the request is " +
      "ambiguous. When you have enough to answer, reply in prose with the finding and make NO tool call.",
    "Charts & tables: a `query` result is shown to the user as a TABLE by default. You CAN also show a " +
      "CHART — set the `query` tool's `display` argument to \"chart\" (chart with the table collapsed) " +
      "or \"both\" (chart + table), and pass a `chart` type (bar/line/area/pie) when the user wants a " +
      "specific one. Charts need chart-friendly data: one label column + one numeric column (usually an " +
      "aggregate like a count/sum grouped by a category or time bucket, e.g. cancellations per month). " +
      "Only ask for a chart when it genuinely helps (a breakdown, share, or trend) — don't chart tiny or " +
      "non-aggregated results. NEVER tell the user you can't show a chart or send them to a spreadsheet.",
    "Rules:",
    "- A pasted URL, short link, slug, email, or ID is a DATA lookup — use `query` to find it; never say you can't browse the web.",
    "- If a reference is ambiguous ('he', 'it', 'this', 'his project') with no clear antecedent in the conversation, call `clarify` — do not guess or invent an entity.",
    "- Verify an entity exists (via `query`) before reasoning about it. If a lookup returns no rows, say nothing was found — never describe an empty/NULL result as a real finding.",
    "- Be concise. Only state numbers/values present in query results; never invent data.",
    "- The result TABLE (and chart, if any) is rendered to the user automatically BELOW your reply. Do " +
      "NOT reproduce the data as a Markdown table or a long list in your reply — summarize the key " +
      "takeaway in prose and refer to what's shown (e.g. \"the breakdown is in the table below\"). " +
      "Quoting one or two key figures inline is fine; never restate the full result.",
    "",
    "Tables you can query (ask `query` in plain English; it knows the columns):",
    tableList,
  ].join("\n");
}

function historyToMessages(history: ConversationTurn[]): LLMToolMessage[] {
  const msgs: LLMToolMessage[] = [];
  for (const h of history) {
    msgs.push({ role: "user", content: h.question });
    msgs.push({
      role: "assistant",
      content: h.answer ? h.answer : h.ok ? "(answered with data)" : "(the previous attempt failed)",
    });
  }
  return msgs;
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDeps,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const maxSteps = deps.maxSteps ?? 6;
  const maxRows = deps.maxRows ?? 1000;

  try {
    const summaries = await deps.memory.getTableSummaries();
    const messages: LLMToolMessage[] = [
      { role: "system", content: buildSystemPrompt(summaries) },
      ...historyToMessages(input.history ?? []),
      { role: "user", content: input.question },
    ];
    const ctx: ToolContext = {
      reasoner: deps.reasoner,
      memory: deps.memory,
      execute: deps.execute,
      emit,
      userEmail: input.userEmail,
      conversationId: input.conversationId ?? null,
      maxRows,
    };
    let primaryLogId: string | null = null;

    for (let step = 0; step < maxSteps; step++) {
      emit({ type: "phase", phase: "working" });
      const turn = await deps.orchestrator.chatWithTools(messages, TOOL_DEFS);

      if (turn.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: turn.content ?? "",
          tool_calls: turn.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
        for (const call of turn.toolCalls) {
          const outcome = await dispatchTool(call, ctx);
          if (outcome.logId) primaryLogId = outcome.logId;
          messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
          if (outcome.clarify) {
            emit({ type: "narration", delta: outcome.clarify });
            emit({ type: "phase", phase: "done" });
            emit({ type: "done", logId: null });
            return;
          }
          if (outcome.confirm) {
            emit({
              type: "confirm_required",
              token: outcome.confirm.token,
              estCost: outcome.confirm.estCost,
              estRows: outcome.confirm.estRows,
              sql: outcome.confirm.sql,
              question: outcome.confirm.question,
            });
            emit({ type: "phase", phase: "done" });
            emit({ type: "done", logId: null });
            return;
          }
        }
        continue;
      }

      const answer = (turn.content ?? "").trim();
      emit({ type: "narration", delta: answer || "I couldn't find an answer to that." });
      emit({ type: "phase", phase: "done" });
      emit({ type: "done", logId: primaryLogId });
      return;
    }

    emit({ type: "phase", phase: "error" });
    emit({
      type: "error",
      error: "I couldn't complete that within the step limit. Try narrowing the question.",
    });
  } catch (err) {
    emit({ type: "phase", phase: "error" });
    emit({ type: "error", error: err instanceof Error ? err.message : "Agent failed" });
  }
}
