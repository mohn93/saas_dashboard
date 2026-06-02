import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  ChartSpec,
  ConversationTurn,
  TableSummary,
} from "./types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClient {
  complete(messages: LLMMessage[]): Promise<string>;
}

export function getDeepSeekClient(): LLMClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY must be set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  return {
    async complete(messages: LLMMessage[]): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0, stream: false }),
      });
      if (!res.ok) {
        throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM returned no content");
      return content;
    },
  };
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

export async function selectTables(
  llm: LLMClient,
  question: string,
  tables: TableSummary[],
  history?: ConversationTurn[]
): Promise<string[]> {
  const known = new Set(tables.map((t) => t.table));
  const list = tables
    .map((t) => `- ${t.table}${t.description ? `: ${t.description}` : ""}`)
    .join("\n");
  const priorQuestions = (history ?? [])
    .map((h) => h.question)
    .filter(Boolean)
    .join("; ");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You select which database tables are needed to answer a question. " +
        "If the question is a follow-up (e.g. 'try again', 'fix it', 'now by month'), " +
        "use the recent questions to infer the intended data question. " +
        "Reply with ONLY a JSON array of table names (a subset of the provided list).",
    },
    {
      role: "user",
      content:
        `Question: ${question}\n` +
        (priorQuestions ? `Recent questions in this conversation: ${priorQuestions}\n` : "") +
        `\nTables:\n${list}`,
    },
  ];

  try {
    const raw = await llm.complete(messages);
    const parsed = extractJson(raw);
    if (Array.isArray(parsed)) {
      const picked = parsed
        .filter((x): x is string => typeof x === "string")
        .filter((t) => known.has(t));
      if (picked.length > 0) return picked;
    }
  } catch {
    /* fall through */
  }
  return tables.map((t) => t.table); // safe fallback: everything
}

export interface GenerateSqlInput {
  question: string;
  columns: CatalogColumn[];
  foreignKeys: CatalogForeignKey[];
  examples: AgentExample[];
  history?: ConversationTurn[];
  priorError?: string | null;
}

export interface GeneratedSql {
  sql: string;
  chart: ChartSpec;
}

const DEFAULT_CHART: ChartSpec = { type: "none", xColumn: null, yColumn: null };

export async function generateSql(
  llm: LLMClient,
  input: GenerateSqlInput
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
  const history = (input.history ?? [])
    .map((h) =>
      h.ok
        ? `Earlier question: ${h.question}\nSQL used: ${h.sql}`
        : `Earlier question: ${h.question}\nThat attempt FAILED` +
          (h.error ? ` (error: ${h.error})` : "") +
          (h.sql ? `\nFailed SQL: ${h.sql}` : "")
    )
    .join("\n\n");

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You translate a question into ONE read-only PostgreSQL SELECT. " +
        "Never write data (no INSERT/UPDATE/DELETE/DDL). Use only the given columns. " +
        "If the user message is a follow-up (e.g. 'try again', 'fix it', or 'now by month'), " +
        "use 'Conversation so far' to recover the actual data question and answer THAT — " +
        "if an earlier attempt FAILED, re-attempt the same intent. " +
        "Always return a real analytical query against the schema; never a placeholder like SELECT 'ok'. " +
        'Reply with ONLY JSON: {"sql": string, "chart": {"type": "bar"|"line"|"area"|"none", ' +
        '"xColumn": string|null, "yColumn": string|null}}. ' +
        "Choose a chart only if the result is naturally chartable; otherwise type \"none\".",
    },
    {
      role: "user",
      content:
        `Question: ${input.question}\n\n` +
        (history ? `Conversation so far:\n${history}\n\n` : "") +
        `Columns:\n${cols}\n\n` +
        (fks ? `Foreign keys:\n${fks}\n\n` : "") +
        (examples ? `Proven examples:\n${examples}\n\n` : "") +
        (input.priorError
          ? `Your previous SQL failed with: ${input.priorError}\nFix it.\n`
          : ""),
    },
  ];

  const raw = await llm.complete(messages);
  const parsed = extractJson(raw) as { sql?: unknown; chart?: Partial<ChartSpec> };
  if (!parsed || typeof parsed.sql !== "string") {
    throw new Error("LLM did not return a SQL string");
  }
  const chart: ChartSpec = parsed.chart
    ? {
        type: (["bar", "line", "area", "none"].includes(parsed.chart.type as string)
          ? parsed.chart.type
          : "none") as ChartSpec["type"],
        xColumn: (parsed.chart.xColumn as string) ?? null,
        yColumn: (parsed.chart.yColumn as string) ?? null,
      }
    : DEFAULT_CHART;
  return { sql: parsed.sql, chart };
}
