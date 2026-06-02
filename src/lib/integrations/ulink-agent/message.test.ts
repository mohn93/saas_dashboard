import { describe, expect, it } from "vitest";
import { applyEvent, emptyMessage, hydrateMessage } from "./message";

describe("applyEvent (message reducer)", () => {
  it("accumulates reasoning, steps, narration and finalizes on done", () => {
    let m = emptyMessage("m1", "how many links");
    m = applyEvent(m, { type: "reasoning", delta: "think " });
    m = applyEvent(m, { type: "reasoning", delta: "more" });
    m = applyEvent(m, { type: "step", label: "Selected tables", detail: "links" });
    m = applyEvent(m, { type: "sql", sql: "SELECT 1" });
    m = applyEvent(m, {
      type: "result",
      columns: ["n"],
      rows: [{ n: 5 }],
      rowCount: 1,
      chart: { type: "none", xColumn: null, yColumn: null },
    });
    m = applyEvent(m, { type: "narration", delta: "You have 5 links." });
    m = applyEvent(m, { type: "done", logId: "log-1" });

    expect(m.reasoning).toBe("think more");
    expect(m.steps).toHaveLength(1);
    expect(m.sql).toBe("SELECT 1");
    expect(m.result?.rowCount).toBe(1);
    expect(m.narration).toBe("You have 5 links.");
    expect(m.logId).toBe("log-1");
    expect(m.loading).toBe(false);
  });
});

describe("conversation event", () => {
  it("is a no-op on the message", () => {
    const before = emptyMessage("m1", "q");
    const after = applyEvent(before, {
      type: "conversation",
      conversationId: "c1",
      title: "q",
    });
    expect(after).toEqual(before);
  });
});

describe("hydrateMessage", () => {
  it("rebuilds a finished AgentMessage from a stored payload", () => {
    const payload = {
      ...emptyMessage("", "how many links"),
      narration: "You have 5 links.",
      sql: "SELECT 1",
      logId: "log-1",
      loading: true, // stored value should be overridden
    };
    const m = hydrateMessage("row-1", "how many links", payload);
    expect(m.id).toBe("row-1");
    expect(m.question).toBe("how many links");
    expect(m.narration).toBe("You have 5 links.");
    expect(m.loading).toBe(false);
  });

  it("tolerates a partial/missing payload by falling back to defaults", () => {
    const m = hydrateMessage("row-2", "q", {});
    expect(m.id).toBe("row-2");
    expect(m.narration).toBe("");
    expect(m.loading).toBe(false);
  });
});
