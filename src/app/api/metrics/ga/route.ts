import { NextRequest, NextResponse } from "next/server";
import { isValidProductSlug } from "@/lib/config/products";
import { getProduct } from "@/lib/config/products";
import {
  fetchKPIs,
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

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<GAMetricsBundle>>> {
  const { searchParams } = request.nextUrl;
  const product = searchParams.get("product");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!product || !start || !end) {
    return NextResponse.json(
      {
        data: null,
        error: "Missing required params: product, start, end",
        cached: false,
        cachedAt: null,
      },
      { status: 400 }
    );
  }

  if (!isValidProductSlug(product)) {
    return NextResponse.json(
      {
        data: null,
        error: `Invalid product: ${product}`,
        cached: false,
        cachedAt: null,
      },
      { status: 400 }
    );
  }

  const productConfig = getProduct(product)!;
  const dateRange: DateRange = { start, end };

  // Check cache
  try {
    const cached = await getCachedMetrics(product, start, end);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as GAMetricsBundle,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data from GA
    try {
      const [
        kpisRaw,
        visitorsRaw,
        pagesRaw,
        referrersRaw,
        countriesRaw,
        devicesRaw,
      ] = await Promise.all([
        fetchKPIs(productConfig.gaPropertyId, dateRange),
        fetchVisitorsOverTime(productConfig.gaPropertyId, dateRange),
        fetchTopPages(productConfig.gaPropertyId, dateRange),
        fetchReferrers(productConfig.gaPropertyId, dateRange),
        fetchCountryBreakdown(productConfig.gaPropertyId, dateRange),
        fetchDeviceBreakdown(productConfig.gaPropertyId, dateRange),
      ]);

      const bundle: GAMetricsBundle = {
        kpis: transformKPIs(kpisRaw),
        visitorsOverTime: transformVisitorsOverTime(visitorsRaw),
        topPages: transformTopPages(pagesRaw),
        referrers: transformReferrers(referrersRaw),
        countries: transformCountryBreakdown(countriesRaw),
        devices: transformDeviceBreakdown(devicesRaw),
      };

      // Cache the result (fire and forget)
      setCachedMetrics(product, start, end, bundle).catch(console.error);

      return NextResponse.json({
        data: bundle,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch (gaError) {
      console.error("GA fetch failed:", gaError);

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
        {
          data: null,
          error: "Failed to fetch analytics data",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  } catch (cacheError) {
    console.error("Cache check failed:", cacheError);

    // If cache layer fails entirely, try GA directly
    try {
      const [
        kpisRaw,
        visitorsRaw,
        pagesRaw,
        referrersRaw,
        countriesRaw,
        devicesRaw,
      ] = await Promise.all([
        fetchKPIs(productConfig.gaPropertyId, dateRange),
        fetchVisitorsOverTime(productConfig.gaPropertyId, dateRange),
        fetchTopPages(productConfig.gaPropertyId, dateRange),
        fetchReferrers(productConfig.gaPropertyId, dateRange),
        fetchCountryBreakdown(productConfig.gaPropertyId, dateRange),
        fetchDeviceBreakdown(productConfig.gaPropertyId, dateRange),
      ]);

      const bundle: GAMetricsBundle = {
        kpis: transformKPIs(kpisRaw),
        visitorsOverTime: transformVisitorsOverTime(visitorsRaw),
        topPages: transformTopPages(pagesRaw),
        referrers: transformReferrers(referrersRaw),
        countries: transformCountryBreakdown(countriesRaw),
        devices: transformDeviceBreakdown(devicesRaw),
      };

      return NextResponse.json({
        data: bundle,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch {
      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch analytics data",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  }
}
