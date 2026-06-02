import { describe, expect, it } from "vitest";
import { deriveTitle, persistTurn, type ConversationStore } from "./conversations";
import type { AgentEvent } from "./events";
import type { AgentMessage } from "./message";

describe("deriveTitle", () => {
  it("uses the trimmed first line", () => {
    expect(deriveTitle("  How many signups this week?  ")).toBe(
      "How many signups this week?"
    );
  });
  it("takes only the first line", () => {
    expect(deriveTitle("revenue by month\nand also churn")).toBe("revenue by month");
  });
  it("truncates long questions with an ellipsis", () => {
    const long = "a".repeat(80);
    const out = deriveTitle(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("a".repeat(59) + "…");
  });
  it("falls back to 'New chat' when empty", () => {
    expect(deriveTitle("   ")).toBe("New chat");
  });
});

function fakeStore() {
  const calls = {
    created: [] as { title: string; userEmail: string | null }[],
    appended: [] as {
      conversationId: string;
      question: string;
      payload: AgentMessage;
      userEmail: string | null;
    }[],
  };
  const store: ConversationStore = {
    createConversation: async (input) => {
      calls.created.push(input);
      return { id: "new-convo-id" };
    },
    appendMessage: async (input) => {
      calls.appended.push(input);
    },
    listConversations: async () => [],
    getConversation: async () => {
      throw new Error("unused");
    },
    deleteConversation: async () => {},
  };
  return { store, calls };
}

const events: AgentEvent[] = [
  { type: "narration", delta: "You have 5 links." },
  { type: "done", logId: "log-1" },
];

describe("persistTurn", () => {
  it("creates a conversation on the first turn and appends the message", async () => {
    const { store, calls } = fakeStore();
    const out = await persistTurn(store, {
      question: "how many links?",
      conversationId: null,
      userEmail: "pm@x.com",
      events,
    });
    expect(out.conversationId).toBe("new-convo-id");
    expect(out.title).toBe("how many links?");
    expect(calls.created).toHaveLength(1);
    expect(calls.appended).toHaveLength(1);
    expect(calls.appended[0].conversationId).toBe("new-convo-id");
    expect(calls.appended[0].payload.narration).toBe("You have 5 links.");
    expect(calls.appended[0].payload.logId).toBe("log-1");
  });

  it("reuses an existing conversation id without creating one", async () => {
    const { store, calls } = fakeStore();
    const out = await persistTurn(store, {
      question: "now by month",
      conversationId: "existing-id",
      userEmail: "pm@x.com",
      events,
    });
    expect(out.conversationId).toBe("existing-id");
    expect(out.title).toBe("now by month"); // derived from the current question
    expect(calls.created).toHaveLength(0);
    expect(calls.appended[0].conversationId).toBe("existing-id");
  });
});
