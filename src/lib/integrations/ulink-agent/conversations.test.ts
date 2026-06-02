import { describe, expect, it } from "vitest";
import { deriveTitle } from "./conversations";

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
  });
  it("falls back to 'New chat' when empty", () => {
    expect(deriveTitle("   ")).toBe("New chat");
  });
});
