import { CHART_TYPES } from "./types";
import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  ChartSpec,
} from "./types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Message shape for the tool-calling protocol (adds the `tool` role + tool_calls).
export interface LLMToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

// OpenAI-style tool definition.
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolChatResult {
  content: string | null;
  toolCalls: ParsedToolCall[];
}

export interface StreamHandlers {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface LLMClient {
  model: string;
  stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string>;
  chatWithTools(messages: LLMToolMessage[], tools: ToolDef[]): Promise<ToolChatResult>;
}

// Pure: normalize a /chat/completions assistant message into content + tool calls.
export function parseToolCalls(message: {
  content?: unknown;
  tool_calls?: unknown;
}): ToolChatResult {
  const raw = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: ParsedToolCall[] = raw
    .map((tc: Record<string, unknown>) => {
      const fn = (tc?.function ?? {}) as Record<string, unknown>;
      return {
        id: typeof tc?.id === "string" ? tc.id : "",
        name: typeof fn?.name === "string" ? fn.name : "",
        arguments: typeof fn?.arguments === "string" ? fn.arguments : "{}",
      };
    })
    .filter((tc: ParsedToolCall) => tc.id !== "" && tc.name !== "");
  return {
    content: typeof message?.content === "string" ? message.content : null,
    toolCalls,
  };
}

// Parse one SSE line ("data: {json}") into content/reasoning deltas.
// Returns null for keep-alives, [DONE], blank lines, and malformed JSON.
export function parseSseLine(
  line: string
): { content: string; reasoning: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta ?? {};
    return {
      content: typeof delta.content === "string" ? delta.content : "",
      reasoning:
        typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    };
  } catch {
    return null;
  }
}

function buildClient(model: string): LLMClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY must be set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  return {
    model,
    async stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: true }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`LLM stream failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      const handle = (line: string) => {
        const parsed = parseSseLine(line);
        if (!parsed) return;
        if (parsed.reasoning) handlers.onReasoning?.(parsed.reasoning);
        if (parsed.content) {
          full += parsed.content;
          handlers.onContent?.(parsed.content);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
      }
      handle(buffer);
      return full;
    },
    async chatWithTools(
      messages: LLMToolMessage[],
      tools: ToolDef[]
    ): Promise<ToolChatResult> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0,
          stream: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM tool call failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      return parseToolCalls(json?.choices?.[0]?.message ?? {});
    },
  };
}

export function getDeepSeekClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_MODEL || "deepseek-reasoner");
}

export function getFastClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_FAST_MODEL || "deepseek-chat");
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to the first {...} or [...] span.
    const firstObj = body.indexOf("{");
    const firstArr = body.indexOf("[");
    const candidates: Array<[number, string, string]> = [];
    if (firstObj >= 0) candidates.push([firstObj, "{", "}"]);
    if (firstArr >= 0) candidates.push([firstArr, "[", "]"]);
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [start, , close] of candidates) {
      const end = body.lastIndexOf(close);
      if (end > start) {
        try {
          return JSON.parse(body.slice(start, end + 1));
        } catch {
          /* try next */
        }
      }
    }
    throw new Error("No JSON found in LLM response");
  }
}

export interface GenerateSqlInput {
  question: string;
  columns: CatalogColumn[];
  foreignKeys: CatalogForeignKey[];
  examples: AgentExample[];
  chartHint?: ChartSpec["type"]; // caller-requested chart type (e.g. the user asked for a pie)
}

export interface GeneratedSql {
  sql: string;
  chart: ChartSpec;
}

const DEFAULT_CHART: ChartSpec = { type: "none", xColumn: null, yColumn: null };

export async function generateSql(
  llm: LLMClient,
  input: GenerateSqlInput,
  onReasoning?: (delta: string) => void
): Promise<GeneratedSql> {
  const cols = input.columns
    .map(
      (c) =>
        `${c.table}.${c.column} (${c.dataType}${c.isNullable ? "" : ", not null"})` +
        (c.description ? ` -- ${c.description}` : "")
    )
    .join("\n");
  const fks = input.foreignKeys
    .map((f) => `${f.table}.${f.column} -> ${f.refTable}.${f.refColumn}`)
    .join("\n");
  const examples = input.examples
    .map((e) => `Q: ${e.question}\nSQL: ${e.sql}`)
    .join("\n\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You translate a question into ONE read-only PostgreSQL SELECT. " +
        "Never write data (no INSERT/UPDATE/DELETE/DDL). Use only the given columns. " +
        "The question is already self-contained (the orchestrator resolves any follow-up before calling you). " +
        "Always return a real analytical query against the schema; never a placeholder like SELECT 'ok'. " +
        "When checking whether a specific entity exists or matches an identifier (slug/email/id), " +
        "filter in WHERE so the query returns ZERO rows when there is no match; do NOT use scalar " +
        "sub-selects that always return one (possibly all-NULL) row. " +
        'Reply with ONLY JSON: {"sql": string, "chart": {"type": "bar"|"line"|"area"|"pie"|"none", ' +
        '"xColumn": string|null, "yColumn": string|null}}. ' +
        "Choose a chart only if the result is naturally chartable; otherwise type \"none\". " +
        "For a chart, the query MUST return a label column (xColumn) and a numeric value column " +
        "(yColumn) — usually an aggregate like count/sum grouped by a category or time bucket. " +
        "Use \"pie\" for a share/breakdown across a few categories (xColumn = category label, " +
        "yColumn = the numeric value); \"bar\" for category comparisons; \"line\"/\"area\" for time series.",
    },
    {
      role: "user",
      content:
        `Question: ${input.question}\n\n` +
        `Columns:\n${cols}\n\n` +
        (fks ? `Foreign keys:\n${fks}\n\n` : "") +
        (examples ? `Proven examples:\n${examples}\n\n` : "") +
        (input.chartHint && input.chartHint !== "none"
          ? `The user wants a ${input.chartHint} chart. REQUIRED: shape the SELECT to return a label ` +
            `column and a numeric value column, and set chart.type to "${input.chartHint}" with ` +
            `xColumn = the label and yColumn = the numeric value.\n`
          : ""),
    },
  ];

  const raw = await llm.stream(messages, { onReasoning });
  const parsed = extractJson(raw) as { sql?: unknown; chart?: Partial<ChartSpec> };
  if (!parsed || typeof parsed.sql !== "string") {
    throw new Error("LLM did not return a SQL string");
  }
  const chart: ChartSpec = parsed.chart
    ? {
        type: ((CHART_TYPES as readonly string[]).includes(parsed.chart.type as string)
          ? parsed.chart.type
          : "none") as ChartSpec["type"],
        xColumn: (parsed.chart.xColumn as string) ?? null,
        yColumn: (parsed.chart.yColumn as string) ?? null,
      }
    : DEFAULT_CHART;
  // Honor a caller-requested chart type when the result has usable axes — the caller
  // (the orchestrator, relaying the user) decides the chart, not the SQL model.
  if (input.chartHint && input.chartHint !== "none" && chart.xColumn && chart.yColumn) {
    chart.type = input.chartHint;
  }
  return { sql: parsed.sql, chart };
}
