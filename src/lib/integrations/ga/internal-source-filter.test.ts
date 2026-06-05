import { describe, expect, it } from "vitest";
import {
  INTERNAL_SOURCE_REGEXP,
  excludeInternalSourceFilter,
  withInternalSourceExcluded,
} from "./internal-source-filter";

// The GA4 FULL_REGEXP value is an RE2 pattern; we validate it via JS RegExp
// (case-insensitive, since the GA filter sets caseSensitive: false).
const re = new RegExp(INTERNAL_SOURCE_REGEXP, "i");

describe("INTERNAL_SOURCE_REGEXP", () => {
  it.each([
    "shared.ly",
    "wow.shared.ly",
    "wowgirl.shared.ly",
    "vijaythalapati.shared.ly",
    "ULINK.LY",
    "app.ulink.ly",
  ])("matches internal source %s", (source) => {
    expect(re.test(source)).toBe(true);
  });

  it.each([
    "notshared.ly", // no leading dot/start boundary
    "shared-ly.com",
    "shared.ly.evil.com", // anchored at end — suffix collision must not match
    "ulink.ly.example.com",
    "google",
    "accounts.google.com",
    "landing",
  ])("does NOT match external/decoy source %s", (source) => {
    expect(re.test(source)).toBe(false);
  });
});

describe("excludeInternalSourceFilter", () => {
  it("wraps a sessionSource FULL_REGEXP match in a notExpression", () => {
    expect(excludeInternalSourceFilter()).toEqual({
      notExpression: {
        filter: {
          fieldName: "sessionSource",
          stringFilter: {
            matchType: "FULL_REGEXP",
            value: INTERNAL_SOURCE_REGEXP,
            caseSensitive: false,
          },
        },
      },
    });
  });
});

describe("withInternalSourceExcluded", () => {
  it("returns just the exclusion when no caller filter is given", () => {
    expect(withInternalSourceExcluded()).toEqual(excludeInternalSourceFilter());
  });

  it("AND-combines the caller filter with the exclusion", () => {
    const caller = {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH", value: "/dashboard" },
      },
    };
    expect(withInternalSourceExcluded(caller)).toEqual({
      andGroup: {
        expressions: [caller, excludeInternalSourceFilter()],
      },
    });
  });
});
