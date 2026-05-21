/**
 * Filters GA "Top referrers" rows that point at our own product subdomains —
 * those aren't external traffic, they're internal noise (a click on a ULink
 * customer's deep link bounces through wow.shared.ly back to ulink.ly and GA
 * records the shared.ly host as the referrer).
 *
 * Add patterns here as more products gain their own internal noise. Today
 * only ULink has GA metrics (see products.ts), so all patterns here are
 * ULink-flavored.
 */

import type { ReferrerSource } from "@/lib/types";

// Each pattern is anchored at the end so we match the apex (`shared.ly`) and
// every subdomain (`wow.shared.ly`, `vijaythalapati.shared.ly`, etc.) but NOT
// suffix collisions like `notshared.ly` or `ulink.ly.example.com`.
export const INTERNAL_REFERRER_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\.)shared\.ly$/i, // ULink customer deep-link subdomains
  /(^|\.)ulink\.ly$/i,  // ULink intra-product navigation
];

/**
 * True when `source` matches one of our internal-product patterns.
 * Safe to call with empty/null/non-string values.
 */
export function isInternalReferrer(source: string | undefined | null): boolean {
  if (!source || typeof source !== "string") return false;
  return INTERNAL_REFERRER_PATTERNS.some((p) => p.test(source));
}

/**
 * Drop internal referrers from a list of GA referrer rows. Pure / immutable.
 */
export function filterInternalReferrers(
  referrers: ReferrerSource[],
): ReferrerSource[] {
  return referrers.filter((r) => !isInternalReferrer(r.source));
}
