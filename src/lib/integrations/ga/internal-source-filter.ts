/**
 * Builds the GA4 dimension-filter clause that EXCLUDES sessions whose source
 * is one of our own product domains (*.shared.ly, *.ulink.ly).
 *
 * This is the query-time counterpart to `internal-referrer-filter`:
 *   - `internal-referrer-filter` drops shared.ly rows from the referrers
 *     TABLE *after* fetching — cosmetic to the source breakdown only.
 *   - This pushes the exclusion DOWN into every GA query so the aggregate
 *     KPIs (New Users, Sessions, page views, ...) also stop counting internal
 *     self-referral traffic (a click on a customer's deep link bounces through
 *     wow.shared.ly back to ulink.ly and GA records a session).
 *
 * Because the flywheel re-queries the GA Data API live for whatever range the
 * user picks, applying the exclusion here cleans HISTORICAL data too — GA4
 * itself can't be rewritten, but our reported numbers can exclude this traffic
 * retroactively.
 */

// RE2 pattern (GA4 FULL_REGEXP). Anchored at both ends so it matches the apex
// `shared.ly` and any subdomain `wow.shared.ly`, but NOT suffix collisions
// like `notshared.ly` or `shared.ly.evil.com`.
export const INTERNAL_SOURCE_REGEXP = "^(.*\\.)?(shared\\.ly|ulink\\.ly)$";

// Exact sessionSource values that are internal artifacts, not real acquisition.
//
// The app used to send a `source` event parameter on internal CTAs
// (PRICING_PAGE_VIEWED, UPGRADE_PROMPT_*, CHECKOUT_COMPLETED,
// DOMAIN_CREATION_STARTED). `source` is a GA4-RESERVED param that overrides the
// session's traffic source, so those CTA tags surfaced as sessionSource with
// medium=(not set) and newUsers=0 — polluting "Website Visitors". The client now
// emits `cta_source` instead (ulink PR #266), so going forward GA stops
// recording these. This list cleans the data ALREADY recorded (the flywheel
// re-queries GA live, so historical numbers improve too) and is defense in depth.
//
// `(not set)` is GA's own placeholder for sessions it can't attribute — never a
// real source, safe to drop from acquisition KPIs.
export const INTERNAL_SOURCE_TOKENS = [
  "(not set)",
  "landing",
  "dashboard",
  "links_creation_page",
  "plan_billing",
  "usage_dashboard",
  "limit_blocker",
  "subscription_flow",
  "upgrade_flow",
];

type GAFilterExpression = Record<string, unknown>;

/**
 * A GA4 FilterExpression MATCHING sessions from internal traffic: either an
 * internal product domain (regex) OR one of the internal CTA / unattributable
 * source tokens (exact in-list).
 */
export function internalSourceMatchFilter(): GAFilterExpression {
  return {
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
  };
}

/** A GA4 FilterExpression EXCLUDING sessions from our internal product domains. */
export function excludeInternalSourceFilter(): GAFilterExpression {
  return { notExpression: internalSourceMatchFilter() };
}

/**
 * AND-combine the internal-source exclusion with an optional caller-supplied
 * dimension filter (e.g. the `/dashboard` pagePath filter). Returns just the
 * exclusion when no caller filter is given.
 */
export function withInternalSourceExcluded(
  callerFilter?: GAFilterExpression,
): GAFilterExpression {
  const exclusion = excludeInternalSourceFilter();
  if (!callerFilter) return exclusion;
  return { andGroup: { expressions: [callerFilter, exclusion] } };
}
