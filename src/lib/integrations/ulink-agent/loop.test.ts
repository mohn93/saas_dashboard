import { describe, expect, it, vi } from "vitest";
import { answerQuestion } from "./loop";
import type { LLMClient } from "./llm";
import type { MemoryStore, QueryResult } from "./types";

function fakeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    getTableSummaries: async () => [{ table: "users", description: null }],
    getColumnsForTables: async () => [
      { table: "users", column: "id", dataType: "uuid", isNullable: false, description: null },
    ],
    getForeignKeysForTables: async () => [],
    getTrustedExamples: async () => [],
    insertQueryLog: async () => "log-123",
    promoteLogToExample: async () => {},
    replaceCatalog: async () => {},
    ...overrides,
  };
}

const okResult: QueryResult = { columns: ["n"], rows: [{ n: 5 }], rowCount: 1 };

describe("answerQuestion", () => {
  it("returns rows and a logId on a successful first attempt", async () => {
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]') // selectTables
        .mockResolvedValueOnce('{"sql":"SELECT count(*) AS n FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi.fn().mockResolvedValue(okResult);

    const answer = await answerQuestion(
      { question: "how many users", userEmail: "pm@x.com" },
      { llm, memory: fakeMemory(), execute }
    );

    expect(answer.ok).toBe(true);
    expect(answer.result).toEqual(okResult);
    expect(answer.logId).toBe("log-123");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries on execution error then succeeds", async () => {
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]')
        .mockResolvedValueOnce('{"sql":"SELECT bad FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}')
        .mockResolvedValueOnce('{"sql":"SELECT count(*) AS n FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('column "bad" does not exist'))
      .mockResolvedValueOnce(okResult);

    const answer = await answerQuestion(
      { question: "q", userEmail: null },
      { llm, memory: fakeMemory(), execute, maxAttempts: 3 }
    );

    expect(answer.ok).toBe(true);
    expect(answer.attempts).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting attempts and logs the failure", async () => {
    const insertQueryLog = vi.fn().mockResolvedValue("log-err");
    const llm: LLMClient = {
      complete: vi
        .fn()
        .mockResolvedValueOnce('["users"]')
        .mockResolvedValue('{"sql":"SELECT bad FROM users","chart":{"type":"none","xColumn":null,"yColumn":null}}'),
    };
    const execute = vi.fn().mockRejectedValue(new Error("boom"));

    const answer = await answerQuestion(
      { question: "q", userEmail: null },
      { llm, memory: fakeMemory({ insertQueryLog }), execute, maxAttempts: 2 }
    );

    expect(answer.ok).toBe(false);
    expect(answer.error).toBeTruthy();
    expect(insertQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
