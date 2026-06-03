import { generateSql, type LLMClient, type ParsedToolCall, type ToolDef } from "./llm";
import { validateSelect } from "./validate";
import type { AgentEvent } from "./events";
import type { ChartSpec, MemoryStore, QueryResult } from "./types";

const CHART_TYPES = ["bar", "line", "area", "pie", "none"] as const;

export const QUERY_TOOL = "query";
export const CLARIFY_TOOL = "clarify";
const MAX_PREVIEW_ROWS = 50; // rows handed back to the orchestrator (bounded for tokens)

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: QUERY_TOOL,
      description:
        "Answer a data question by writing and running ONE read-only SQL query against ULink's " +
        "database. Pass a clear, self-contained question in plain English; it returns the rows and " +
        "the SQL used. Use it to look things up and to verify whether something exists.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "A self-contained data question in plain English.",
          },
          chart: {
            type: "string",
            enum: ["bar", "line", "area", "pie", "none"],
            description:
              "Optional: the chart type to render when the user asked for a specific one " +
              "(e.g. 'pie'). Honored as long as the result has a label column + a numeric column. " +
              "Omit to let the system pick automatically.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: CLARIFY_TOOL,
      description:
        "Ask the user a clarifying question when their request is ambiguous or missing detail " +
        "(e.g. an unclear referent, missing time range, or which entity/metric they mean). " +
        "Use this instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The clarifying question to ask the user." },
        },
        required: ["question"],
      },
    },
  },
];

export interface ToolContext {
  reasoner: LLMClient; // R1, writes the SQL inside `query`
  memory: MemoryStore;
  execute: (sql: string) => Promise<QueryResult>;
  emit: (event: AgentEvent) => void;
  userEmail: string | null;
  maxRows: number;
}

export interface ToolOutcome {
  content: string; // tool result string fed back to the orchestrator
  logId?: string; // set by a successful query → becomes the turn's primary logId
  clarify?: string; // set by clarify → the loop terminates, asking this question
}

async function runQuery(
  question: string,
  ctx: ToolContext,
  chartHint?: ChartSpec["type"]
): Promise<ToolOutcome> {
  ctx.emit({ type: "step", label: "Querying", detail: question });

  const summaries = await ctx.memory.getTableSummaries();
  const tables = summaries.map((t) => t.table);
  const [columns, foreignKeys, examples] = await Promise.all([
    ctx.memory.getColumnsForTables(tables),
    ctx.memory.getForeignKeysForTables(tables),
    ctx.memory.getTrustedExamples(),
  ]);

  let gen;
  try {
    gen = await generateSql(
      ctx.reasoner,
      { question, columns, foreignKeys, examples, chartHint },
      (delta) => ctx.emit({ type: "reasoning", delta })
    );
  } catch (err) {
    return {
      content: JSON.stringify({
        error: err instanceof Error ? err.message : "Could not generate SQL",
      }),
    };
  }

  const v = validateSelect(gen.sql, ctx.maxRows);
  if (!v.ok) {
    await ctx.memory.insertQueryLog({
      question,
      sql: gen.sql,
      attempts: 1,
      rowCount: null,
      success: false,
      error: v.error,
      userEmail: ctx.userEmail,
    });
    return { content: JSON.stringify({ error: v.error ?? "Invalid SQL" }) };
  }

  ctx.emit({ type: "sql", sql: gen.sql });
  ctx.emit({ type: "phase", phase: "running" });

  let result: QueryResult;
  try {
    result = await ctx.execute(v.sql);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Query failed";
    await ctx.memory.insertQueryLog({
      question,
      sql: gen.sql,
      attempts: 1,
      rowCount: null,
      success: false,
      error,
      userEmail: ctx.userEmail,
    });
    return { content: JSON.stringify({ error }) };
  }

  ctx.emit({
    type: "result",
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    chart: gen.chart,
  });

  const logId = await ctx.memory.insertQueryLog({
    question,
    sql: gen.sql,
    attempts: 1,
    rowCount: result.rowCount,
    success: true,
    error: null,
    userEmail: ctx.userEmail,
  });

  return {
    content: JSON.stringify({
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows.slice(0, MAX_PREVIEW_ROWS),
      sql: gen.sql,
    }),
    logId,
  };
}

export async function dispatchTool(
  call: ParsedToolCall,
  ctx: ToolContext
): Promise<ToolOutcome> {
  let args: { question?: unknown; chart?: unknown };
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { content: JSON.stringify({ error: `Invalid JSON arguments for ${call.name}` }) };
  }
  const question = typeof args.question === "string" ? args.question.trim() : "";
  const chartHint = CHART_TYPES.includes(args.chart as (typeof CHART_TYPES)[number])
    ? (args.chart as ChartSpec["type"])
    : undefined;

  if (call.name === QUERY_TOOL) {
    if (!question) return { content: JSON.stringify({ error: "query requires a 'question' string" }) };
    return runQuery(question, ctx, chartHint);
  }
  if (call.name === CLARIFY_TOOL) {
    if (!question) return { content: JSON.stringify({ error: "clarify requires a 'question' string" }) };
    return { content: "Clarification requested from the user.", clarify: question };
  }
  return { content: JSON.stringify({ error: `Unknown tool: ${call.name}` }) };
}
