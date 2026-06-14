import type { LLMClient } from "./llm";
import type { QueryResult } from "./types";

// A single, tool-free LLM pass that summarizes a query result in prose. Used by
// the confirm route (which executes an already-approved query and needs a reply
// without re-running the full orchestration loop). Streams content deltas.
export async function narrateResult(
  llm: LLMClient,
  question: string,
  result: QueryResult,
  onDelta: (delta: string) => void
): Promise<string> {
  const preview = {
    columns: result.columns,
    rowCount: result.rowCount,
    rows: result.rows.slice(0, 50),
  };
  return llm.stream(
    [
      {
        role: "system",
        content:
          "You are the PM Data Agent for ULink. Summarize the result of a data query in 1-2 " +
          "concise sentences. The full result table is rendered to the user automatically below " +
          "your reply, so do NOT reproduce it as a list or markdown table — quote at most a key " +
          "figure or two and refer to the table. Only state numbers present in the result.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nResult (JSON, first 50 rows):\n${JSON.stringify(preview)}`,
      },
    ],
    { onContent: onDelta }
  );
}
