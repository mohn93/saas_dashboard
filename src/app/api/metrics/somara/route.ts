import { NextRequest, NextResponse } from "next/server";
import {
  fetchKPIs,
  fetchActivityOverTime,
  fetchSignupsOverTime,
  fetchTokenUsageOverTime,
  fetchOrgBillingBreakdown,
  fetchTopModels,
  fetchCreditsOverview,
} from "@/lib/integrations/somara/queries";
import { transformSomaraMetrics } from "@/lib/integrations/somara/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/integrations/supabase/cache";
import { parseDateRange } from "@/lib/utils/dates";
import type { ApiResponse, SomaraMetrics } from "@/lib/types";

const METRIC_TYPE = "somara_platform";

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<SomaraMetrics>>> {
  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      {
        data: null,
        error: "Missing required params: start, end",
        cached: false,
        cachedAt: null,
      },
      { status: 400 }
    );
  }

  const product = "somara";

  // Check cache
  try {
    const cached = await getCachedMetrics(product, start, end, METRIC_TYPE);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as SomaraMetrics,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data
    try {
      const { startDate, endDate } = parseDateRange(start, end);

      const [
        kpis,
        activityOverTime,
        signupsOverTime,
        tokenUsageOverTime,
        orgBillingBreakdown,
        topModels,
        creditsOverview,
      ] = await Promise.all([
        fetchKPIs(startDate, endDate),
        fetchActivityOverTime(startDate, endDate),
        fetchSignupsOverTime(startDate, endDate),
        fetchTokenUsageOverTime(startDate, endDate),
        fetchOrgBillingBreakdown(),
        fetchTopModels(),
        fetchCreditsOverview(),
      ]);

      const metrics = transformSomaraMetrics({
        kpis,
        activityOverTime,
        signupsOverTime,
        tokenUsageOverTime,
        orgBillingBreakdown,
        topModels,
        creditsOverview,
        startDate,
        endDate,
      });

      // Cache the result (fire and forget)
      setCachedMetrics(product, start, end, metrics, METRIC_TYPE).catch(
        console.error
      );

      return NextResponse.json({
        data: metrics,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch (fetchError) {
      console.error("Somara metrics fetch failed:", fetchError);

      // Serve stale cache as fallback
      if (cached.data) {
        return NextResponse.json({
          data: cached.data as unknown as SomaraMetrics,
          error: null,
          cached: true,
          cachedAt: cached.cachedAt,
        });
      }

      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch Somara platform metrics",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  } catch (cacheError) {
    console.error("Cache check failed:", cacheError);

    // If cache layer fails, try fetching directly
    try {
      const { startDate, endDate } = parseDateRange(start, end);

      const [
        kpis,
        activityOverTime,
        signupsOverTime,
        tokenUsageOverTime,
        orgBillingBreakdown,
        topModels,
        creditsOverview,
      ] = await Promise.all([
        fetchKPIs(startDate, endDate),
        fetchActivityOverTime(startDate, endDate),
        fetchSignupsOverTime(startDate, endDate),
        fetchTokenUsageOverTime(startDate, endDate),
        fetchOrgBillingBreakdown(),
        fetchTopModels(),
        fetchCreditsOverview(),
      ]);

      const metrics = transformSomaraMetrics({
        kpis,
        activityOverTime,
        signupsOverTime,
        tokenUsageOverTime,
        orgBillingBreakdown,
        topModels,
        creditsOverview,
        startDate,
        endDate,
      });

      return NextResponse.json({
        data: metrics,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch {
      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch Somara platform metrics",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  }
}
