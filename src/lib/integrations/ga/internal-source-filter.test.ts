import { describe, expect, it } from "vitest";
import {
  INTERNAL_SOURCE_REGEXP,
  INTERNAL_SOURCE_TOKENS,
  internalSourceMatchFilter,
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
    "landing", // an internal CTA token, but NOT a domain — caught by the in-list, not the regex
  ])("does NOT match external/decoy source %s", (source) => {
    expect(re.test(source)).toBe(false);
  });
});

describe("INTERNAL_SOURCE_TOKENS", () => {
  it("covers the reserved-`source` CTA values the app used to emit + (not set)", () => {
    // Closed set mirrored from the client's former `source` event-param values
    // (now renamed to `cta_source` in ulink PR #266) plus GA's (not set).
    expect(INTERNAL_SOURCE_TOKENS).toEqual([
      "(not set)",
      "landing",
      "dashboard",
      "links_creation_page",
      "plan_billing",
      "usage_dashboard",
      "limit_blocker",
      "subscription_flow",
      "upgrade_flow",
    ]);
  });
});

describe("internalSourceMatchFilter", () => {
  it("OR-combines the domain regex with the internal-token in-list, both on sessionSource", () => {
    expect(internalSourceMatchFilter()).toEqual({
      orGroup: {
        expressions: [
          {
            filter: {
              fieldName: "sessionSource",
              stringFilter: {
                matchType: "FULL_REGEXP",
                value: INTERNAL_SOURCE_REGEXP,
                caseSensitive: false,
              },
            },
          },
          {
            filter: {
              fieldName: "sessionSource",
              inListFilter: {
                values: INTERNAL_SOURCE_TOKENS,
                caseSensitive: false,
              },
            },
          },
        ],
      },
    });
  });
});

describe("excludeInternalSourceFilter", () => {
  it("wraps the internal-source match in a notExpression", () => {
    expect(excludeInternalSourceFilter()).toEqual({
      notExpression: internalSourceMatchFilter(),
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
