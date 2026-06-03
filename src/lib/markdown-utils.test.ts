import { describe, expect, it } from "vitest";
import { stripMarkdownTables } from "./markdown-utils";

describe("stripMarkdownTables", () => {
  it("removes a pipe table but keeps the surrounding prose", () => {
    const md = [
      "Here's the monthly churn:",
      "",
      "| Month | Canceled |",
      "| --- | --- |",
      "| Aug 2025 | 1 |",
      "| Feb 2026 | 1 |",
      "| Apr 2026 | 2 |",
      "",
      "So there were **4** in total — see the table below.",
    ].join("\n");
    const out = stripMarkdownTables(md);
    expect(out).toContain("Here's the monthly churn:");
    expect(out).toContain("So there were **4** in total");
    expect(out).not.toContain("| Month |");
    expect(out).not.toContain("Aug 2025");
    expect(out).not.toContain("---");
  });

  it("removes a table written without leading/trailing pipes", () => {
    const md = ["Breakdown:", "Month | Canceled", "--- | ---", "Aug 2025 | 1", "", "Done."].join("\n");
    const out = stripMarkdownTables(md);
    expect(out).toContain("Breakdown:");
    expect(out).toContain("Done.");
    expect(out).not.toContain("Aug 2025");
  });

  it("leaves text with no table unchanged (and keeps a horizontal rule)", () => {
    const md = "Just prose.\n\n---\n\nMore prose with a | pipe in it.";
    expect(stripMarkdownTables(md)).toBe(md);
  });

  it("returns prose-only when the whole reply is a table", () => {
    const md = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    expect(stripMarkdownTables(md)).toBe("");
  });
});
