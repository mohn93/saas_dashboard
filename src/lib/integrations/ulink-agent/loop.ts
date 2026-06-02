import { generateSql, selectTables, type LLMClient } from "./llm";
import { validateSelect } from "./validate";
import type {
  AgentAnswer,
  ChartSpec,
  ConversationTurn,
  MemoryStore,
  QueryResult,
} from "./types";

export interface LoopDeps {
  llm: LLMClient;
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  maxRows?: number;
  maxAttempts?: number;
}

export interface LoopInput {
  question: string;
  userEmail: string | null;
  history?: ConversationTurn[];
}

export async function answerQuestion(
  input: LoopInput,
  deps: LoopDeps
): Promise<AgentAnswer> {
  const maxRows = deps.maxRows ?? 1000;
  const maxAttempts = deps.maxAttempts ?? 3;

  const summaries = await deps.memory.getTableSummaries();
  const tables = await selectTables(deps.llm, input.question, summaries, input.history);
  const [columns, foreignKeys, examples] = await Promise.all([
    deps.memory.getColumnsForTables(tables),
    deps.memory.getForeignKeysForTables(tables),
    deps.memory.getTrustedExamples(),
  ]);

  let priorError: string | null = null;
  let lastSql: string | null = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    let chart: ChartSpec = { type: "none", xColumn: null, yColumn: null };
    try {
      const gen = await generateSql(deps.llm, {
        question: input.question,
        columns,
        foreignKeys,
        examples,
        history: input.history,
        priorError,
      });
      chart = gen.chart;
      lastSql = gen.sql;

      const v = validateSelect(gen.sql, maxRows);
      if (!v.ok) {
        priorError = v.error ?? "Invalid SQL";
        continue;
      }

      const result = await deps.execute(v.sql);
      const logId = await deps.memory.insertQueryLog({
        question: input.question,
        sql: gen.sql,
        attempts,
        rowCount: result.rowCount,
        success: true,
        error: null,
        userEmail: input.userEmail,
      });

      return { ok: true, sql: gen.sql, chart, result, error: null, attempts, logId };
    } catch (err) {
      priorError = err instanceof Error ? err.message : String(err);
    }
  }

  const logId = await deps.memory.insertQueryLog({
    question: input.question,
    sql: lastSql,
    attempts,
    rowCount: null,
    success: false,
    error: priorError,
    userEmail: input.userEmail,
  });

  return {
    ok: false,
    sql: lastSql,
    chart: null,
    result: null,
    error: priorError ?? "Failed to answer the question",
    attempts,
    logId,
  };
}
