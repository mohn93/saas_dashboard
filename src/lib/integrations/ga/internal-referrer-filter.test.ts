import { describe, expect, it } from "vitest";
import {
  filterInternalReferrers,
  isInternalReferrer,
  INTERNAL_REFERRER_PATTERNS,
} from "./internal-referrer-filter";
import type { ReferrerSource } from "@/lib/types";

const ref = (source: string, sessions = 10, users = 8): ReferrerSource => ({
  source,
  medium: "referral",
  sessions,
  users,
});

describe("isInternalReferrer", () => {
  it.each([
    "wow.shared.ly",
    "feelty.shared.ly",
    "vijaythalapati.shared.ly",
    "dooreast.shared.ly",
    "shared.ly",
    "app.ulink.ly",
    "ulink.ly",
    "SHARED.LY", // case insensitive
    "Wow.Shared.Ly",
  ])("treats %s as internal", (domain) => {
    expect(isInternalReferrer(domain)).toBe(true);
  });

  it.each([
    "chatgpt.com",
    "google.com",
    "statics.teams.cdn.office.net",
    "ulink.ly.example.com", // suffix collision must NOT match
    "notshared.ly",         // word-boundary check
    "shared-ly.com",
    "",
    null as unknown as string,
    undefined as unknown as string,
  ])("treats %s as external (no-op)", (domain) => {
    expect(isInternalReferrer(domain)).toBe(false);
  });

  it("exposes the patterns for inspection", () => {
    expect(INTERNAL_REFERRER_PATTERNS.length).toBeGreaterThan(0);
    expect(INTERNAL_REFERRER_PATTERNS.every((p) => p instanceof RegExp)).toBe(true);
  });
});

describe("filterInternalReferrers", () => {
  it("strips *.shared.ly and *.ulink.ly entries", () => {
    const input: ReferrerSource[] = [
      ref("wow.shared.ly", 93, 92),
      ref("(direct)", 55, 47),
      ref("wowgirl.shared.ly", 45, 44),
      ref("landing", 23, 8),
      ref("vijaythalapati.shared.ly", 23, 23),
      ref("chatgpt.com", 1, 1),
      ref("app.ulink.ly", 17, 14),
    ];

    const result = filterInternalReferrers(input);

    expect(result.map((r) => r.source)).toEqual([
      "(direct)",
      "landing",
      "chatgpt.com",
    ]);
  });

  it("returns the input unchanged when no internal referrers are present", () => {
    const input: ReferrerSource[] = [
      ref("chatgpt.com"),
      ref("google.com"),
      ref("(direct)"),
    ];
    expect(filterInternalReferrers(input)).toEqual(input);
  });

  it("returns an empty array when all referrers are internal", () => {
    const input: ReferrerSource[] = [
      ref("wow.shared.ly"),
      ref("feelty.shared.ly"),
      ref("ulink.ly"),
    ];
    expect(filterInternalReferrers(input)).toEqual([]);
  });

  it("preserves session and user counts on the rows it keeps", () => {
    const input: ReferrerSource[] = [
      ref("wow.shared.ly", 93, 92),
      ref("chatgpt.com", 1, 1),
    ];
    const result = filterInternalReferrers(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "chatgpt.com",
      sessions: 1,
      users: 1,
      medium: "referral",
    });
  });

  it("does not mutate the input array", () => {
    const input: ReferrerSource[] = [
      ref("wow.shared.ly"),
      ref("chatgpt.com"),
    ];
    const snapshot = input.map((r) => ({ ...r }));
    filterInternalReferrers(input);
    expect(input).toEqual(snapshot);
  });

  it("is a no-op on empty input", () => {
    expect(filterInternalReferrers([])).toEqual([]);
  });
});
