import { describe, it, expect } from "vitest";
import { parseWindow } from "./ratelimit";

describe("parseWindow", () => {
  it("parses seconds, minutes, hours", () => {
    expect(parseWindow("60s")).toBe(60);
    expect(parseWindow("30m")).toBe(1800);
    expect(parseWindow("1h")).toBe(3600);
  });
  it("falls back to 3600 on garbage", () => {
    expect(parseWindow("")).toBe(3600);
    expect(parseWindow("nope")).toBe(3600);
    expect(parseWindow("0s")).toBe(3600);
  });
});
