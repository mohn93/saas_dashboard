import { describe, expect, it } from "vitest";
import { applyEvent, emptyMessage } from "./use-agent-stream";

describe("applyEvent", () => {
  it("accumulates reasoning, steps, narration and finalizes on done", () => {
    let m = emptyMessage("m1", "how many links");
    m = applyEvent(m, { type: "phase", phase: "working" });
    m = applyEvent(m, { type: "step", label: "Selected tables", detail: "links" });
    m = applyEvent(m, { type: "reasoning", delta: "think " });
    m = applyEvent(m, { type: "reasoning", delta: "more" });
    m = applyEvent(m, { type: "sql", sql: "SELECT 1" });
    m = applyEvent(m, {
      type: "result",
      columns: ["n"],
      rows: [{ n: 5 }],
      rowCount: 1,
      chart: { type: "none", xColumn: null, yColumn: null },
    });
    m = applyEvent(m, { type: "narration", delta: "You have " });
    m = applyEvent(m, { type: "narration", delta: "5 links." });
    m = applyEvent(m, { type: "done", logId: "log-1" });

    expect(m.reasoning).toBe("think more");
    expect(m.steps).toHaveLength(1);
    expect(m.sql).toBe("SELECT 1");
    expect(m.result?.rowCount).toBe(1);
    expect(m.narration).toBe("You have 5 links.");
    expect(m.logId).toBe("log-1");
    expect(m.loading).toBe(false);
    expect(m.phase).toBe("done");
  });

  it("sets error and stops loading on error event", () => {
    let m = emptyMessage("m2", "q");
    m = applyEvent(m, { type: "error", error: "boom" });
    expect(m.error).toBe("boom");
    expect(m.loading).toBe(false);
    expect(m.phase).toBe("error");
  });
});
