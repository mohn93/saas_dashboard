import type {
  AgentExample,
  CatalogColumn,
  CatalogForeignKey,
  ChartSpec,
  ConversationTurn,
  QueryResult,
  TableSummary,
} from "./types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamHandlers {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface LLMClient {
  model: string;
  complete(messages: LLMMessage[]): Promise<string>;
  stream(messages: LLMMessage[], handlers: StreamHandlers): Promise<string>;
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
  };
}

export function getDeepSeekClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_MODEL || "deepseek-reasoner");
}

export function getFastClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_FAST_MODEL || "deepseek-chat");
}

// The planner decides chat-vs-data and recovers follow-up intent — the step where
// "understand what the user means" matters most. Default it to the stronger reasoner;
// override with DEEPSEEK_PLANNER_MODEL (e.g. "deepseek-chat") to A/B without a redeploy.
export function getPlannerClient(): LLMClient {
  return buildClient(process.env.DEEPSEEK_PLANNER_MODEL || "deepseek-reasoner");
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

export interface PlanResult {
  kind: "chat" | "data";
  reply?: string;
}

export async function planMessage(
  planner: LLMClient,
  question: string,
  history: ConversationTurn[],
  tables: TableSummary[]
): Promise<PlanResult> {
  const tableList = tables.map((t) => `- ${t.table}`).join("\n");
  const recent = history
    .map(
      (h) =>
        `Q: ${h.question}` +
        (h.answer ? `\nA: ${h.answer}` : h.ok ? "" : " (the attempt failed)")
    )
    .join("\n");
  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are the planner for a ULink analytics assistant. Decide whether the user's " +
        "message needs a database query. Reply with ONLY JSON: " +
        '{"kind":"data"} if it asks about ULink data/metrics, or ' +
        '{"kind":"chat","reply":"..."} for greetings, thanks, clarifications, or general ' +
        "questions, where reply is a brief, friendly answer. If the user refers to a previous " +
        "question (e.g. 'try again', 'now by month'), treat it as data. " +
        "A pasted URL, short link, slug, email, or ID is a DATA lookup (search the data for it) — " +
        "NEVER reply that you can't browse the web. " +
        "If the user is answering a clarifying question you asked, or refining a metric definition, " +
        "continue that thread as data once the definition is clear. " +
        "If the message refers to an entity ambiguously ('he', 'it', 'this', 'his project') with no " +
        "clear referent in the recent conversation, return kind:chat whose reply briefly asks which " +
        "one they mean — do NOT guess or invent an entity.",
    },
    {
      role: "user",
      content:
        `Message: ${question}\n` +
        (recent ? `Recent questions:\n${recent}\n` : "") +
        `\nAvailable tables:\n${tableList}`,
    },
  ];
  try {
    const raw = await planner.complete(messages);
    const parsed = extractJson(raw) as { kind?: string; reply?: string };
    if (parsed?.kind === "chat") {
      return {
        kind: "chat",
        reply:
          typeof parsed.reply === "string" && parsed.reply.trim()
            ? parsed.reply
            : "How can I help with your ULink data?",
      };
    }
    return { kind: "data" };
  } catch {
    return { kind: "data" };
  }
}

export async function narrate(
  fast: LLMClient,
  input: { question: string; sql: string; result: QueryResult },
  onContent: (delta: string) => void
): Promise<string> {
  const preview = {
    columns: input.result.columns,
    rowCount: input.result.rowCount,
    rows: input.result.rows.slice(0, 50),
  };
  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are a data analyst assistant for ULink. Given a question and its query results, " +
        "write a concise, friendly answer (1-4 sentences) stating the key numbers/findings. " +
        "Only use values present in the results; never invent data. Do not show SQL. " +
        "If rowCount is 0, say no matching data was found. " +
        "If the result is a single row whose values are all NULL/empty, or whose key identifying " +
        "column(s) are NULL/empty, treat it as NO MATCH — say nothing was found; do NOT describe a " +
        "NULL/empty result as if it were a real entity or finding.",
    },
    {
      role: "user",
      content:
        `Question: ${input.question}\n\nResults (JSON, up to 50 rows):\n${JSON.stringify(preview)}`,
    },
  ];
  return fast.stream(messages, { onContent });
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
  const history = (input.history ?? [])
    .map((h) =>
      h.ok
        ? `Earlier question: ${h.question}` +
          (h.sql ? `\nSQL used: ${h.sql}` : "") +
          (h.answer ? `\nAssistant answered: ${h.answer}` : "")
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
        "When checking whether a specific entity exists or matches an identifier (slug/email/id), " +
        "filter in WHERE so the query returns ZERO rows when there is no match; do NOT use scalar " +
        "sub-selects that always return one (possibly all-NULL) row. " +
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

  const raw = await llm.stream(messages, { onReasoning });
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
