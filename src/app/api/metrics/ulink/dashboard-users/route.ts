import { NextRequest, NextResponse } from "next/server";
import { getProduct } from "@/lib/config/products";
import {
  fetchDashboardKPIs,
  fetchVisitorsOverTime,
  fetchTopPages,
  fetchReferrers,
  fetchCountryBreakdown,
  fetchDeviceBreakdown,
} from "@/lib/integrations/ga/queries";
import {
  transformKPIs,
  transformVisitorsOverTime,
  transformTopPages,
  transformReferrers,
  transformCountryBreakdown,
  transformDeviceBreakdown,
} from "@/lib/integrations/ga/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/cache/kv";
import type { ApiResponse, GAMetricsBundle, DateRange } from "@/lib/types";

const DASHBOARD_FILTER = {
  filter: {
    fieldName: "pagePath",
    stringFilter: {
      matchType: "BEGINS_WITH",
      value: "/dashboard",
    },
  },
};

const METRIC_TYPE = "ulink_dashboard_users";

async function fetchDashboardUsersBundle(
  propertyId: string,
  dateRange: DateRange
): Promise<GAMetricsBundle> {
  const [kpisRaw, visitorsRaw, pagesRaw, referrersRaw, countriesRaw, devicesRaw] =
    await Promise.all([
      fetchDashboardKPIs(propertyId, dateRange, DASHBOARD_FILTER),
      fetchVisitorsOverTime(propertyId, dateRange, DASHBOARD_FILTER),
      fetchTopPages(propertyId, dateRange, DASHBOARD_FILTER),
      fetchReferrers(propertyId, dateRange, DASHBOARD_FILTER),
      fetchCountryBreakdown(propertyId, dateRange, DASHBOARD_FILTER),
      fetchDeviceBreakdown(propertyId, dateRange, DASHBOARD_FILTER),
    ]);

  return {
    kpis: transformKPIs(kpisRaw),
    visitorsOverTime: transformVisitorsOverTime(visitorsRaw),
    topPages: transformTopPages(pagesRaw),
    referrers: transformReferrers(referrersRaw),
    countries: transformCountryBreakdown(countriesRaw),
    devices: transformDeviceBreakdown(devicesRaw),
  };
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<GAMetricsBundle>>> {
  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { data: null, error: "Missing required params: start, end", cached: false, cachedAt: null },
      { status: 400 }
    );
  }

  const productConfig = getProduct("ulink")!;
  const dateRange: DateRange = { start, end };

  // Check cache
  try {
    const cached = await getCachedMetrics("ulink", start, end, METRIC_TYPE);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as GAMetricsBundle,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data from GA with dashboard filter
    try {
      const bundle = await fetchDashboardUsersBundle(productConfig.gaPropertyId, dateRange);

      // Cache the result (fire and forget)
      setCachedMetrics("ulink", start, end, bundle, METRIC_TYPE).catch(console.error);

      return NextResponse.json({
        data: bundle,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch (gaError) {
      console.error("GA fetch failed (ulink dashboard users):", gaError);

      // Serve stale cache as fallback
      if (cached.data) {
        return NextResponse.json({
          data: cached.data as unknown as GAMetricsBundle,
          error: null,
          cached: true,
          cachedAt: cached.cachedAt,
        });
      }

      return NextResponse.json(
        { data: null, error: "Failed to fetch dashboard users analytics data", cached: false, cachedAt: null },
        { status: 502 }
      );
    }
  } catch (cacheError) {
    console.error("Cache check failed (ulink dashboard users):", cacheError);

    // If cache layer fails entirely, try GA directly
    try {
      const bundle = await fetchDashboardUsersBundle(productConfig.gaPropertyId, dateRange);

      return NextResponse.json({
        data: bundle,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch {
      return NextResponse.json(
        { data: null, error: "Failed to fetch dashboard users analytics data", cached: false, cachedAt: null },
        { status: 502 }
      );
    }
  }
}
