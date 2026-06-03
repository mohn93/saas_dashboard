import { generateSql, narrate, planMessage, selectTables, type LLMClient } from "./llm";
import { validateSelect } from "./validate";
import type { AgentEvent } from "./events";
import type { ChartSpec, ConversationTurn, MemoryStore, QueryResult } from "./types";

export interface AgentDeps {
  reasoner: LLMClient;
  fast: LLMClient;
  planner?: LLMClient; // model for chat-vs-data planning; falls back to `fast`
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxAttempts?: number;
}

export interface AgentInput {
  question: string;
  userEmail: string | null;
  history?: ConversationTurn[];
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDeps,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const maxRows = deps.maxRows ?? 1000;
  const maxAttempts = deps.maxAttempts ?? 3;
  const history = input.history ?? [];

  try {
    emit({ type: "phase", phase: "working" });
    const summaries = await deps.memory.getTableSummaries();
    const plan = await planMessage(deps.planner ?? deps.fast, input.question, history, summaries);

    // --- chat path: no query, just a conversational reply ---
    if (plan.kind === "chat") {
      const reply = plan.reply ?? "How can I help with your ULink data?";
      emit({ type: "narration", delta: reply });
      const logId = await deps.memory.insertQueryLog({
        question: input.question,
        sql: null,
        attempts: 0,
        rowCount: null,
        success: true,
        error: null,
        userEmail: input.userEmail,
      });
      emit({ type: "phase", phase: "done" });
      emit({ type: "done", logId });
      return;
    }

    // --- data path ---
    emit({ type: "phase", phase: "working" });
    const tables = await selectTables(deps.fast, input.question, summaries, history);
    emit({ type: "step", label: "Selected tables", detail: tables.join(", ") });

    const [columns, foreignKeys, examples] = await Promise.all([
      deps.memory.getColumnsForTables(tables),
      deps.memory.getForeignKeysForTables(tables),
      deps.memory.getTrustedExamples(),
    ]);

    emit({ type: "phase", phase: "working" });
    let priorError: string | null = null;
    let lastSql: string | null = null;
    let attempts = 0;
    let chart: ChartSpec | null = null;
    let result: QueryResult | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const gen = await generateSql(
          deps.reasoner,
          { question: input.question, columns, foreignKeys, examples, history, priorError },
          (delta) => emit({ type: "reasoning", delta })
        );
        chart = gen.chart;
        lastSql = gen.sql;

        const v = validateSelect(gen.sql, maxRows);
        if (!v.ok) {
          priorError = v.error ?? "Invalid SQL";
          emit({ type: "step", label: "Fixing query", detail: priorError });
          continue;
        }

        emit({ type: "phase", phase: "running" });
        result = await deps.execute(v.sql);
        break;
      } catch (err) {
        priorError = err instanceof Error ? err.message : String(err);
        emit({ type: "step", label: "Retrying", detail: priorError });
      }
    }

    if (!result) {
      await deps.memory.insertQueryLog({
        question: input.question,
        sql: lastSql,
        attempts,
        rowCount: null,
        success: false,
        error: priorError,
        userEmail: input.userEmail,
      });
      emit({ type: "phase", phase: "error" });
      emit({ type: "error", error: priorError ?? "Failed to answer the question" });
      return;
    }

    emit({ type: "sql", sql: lastSql! });
    emit({
      type: "result",
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      chart,
    });

    emit({ type: "phase", phase: "working" });
    await narrate(
      deps.fast,
      { question: input.question, sql: lastSql!, result },
      (delta) => emit({ type: "narration", delta })
    );

    const logId = await deps.memory.insertQueryLog({
      question: input.question,
      sql: lastSql,
      attempts,
      rowCount: result.rowCount,
      success: true,
      error: null,
      userEmail: input.userEmail,
    });
    emit({ type: "phase", phase: "done" });
    emit({ type: "done", logId });
  } catch (err) {
    emit({ type: "phase", phase: "error" });
    emit({ type: "error", error: err instanceof Error ? err.message : "Agent failed" });
  }
}
