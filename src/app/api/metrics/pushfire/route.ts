import { NextRequest, NextResponse } from "next/server";
import {
  fetchPlatformKPIs,
  fetchBusinessKPIs,
  fetchDailySubscribers,
  fetchDailyNotifications,
  fetchDailyExecutions,
  fetchDeviceBreakdown,
} from "@/lib/integrations/pushfire/queries";
import { transformPushFireMetrics } from "@/lib/integrations/pushfire/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/cache/kv";
import { parseDateRange } from "@/lib/utils/dates";
import type { ApiResponse, PushFireMetrics } from "@/lib/types";

const METRIC_TYPE = "pushfire_platform";

async function fetchAllMetrics(startDate: Date, endDate: Date): Promise<PushFireMetrics> {
  const [
    platformKpis,
    businessKpis,
    dailySubscribers,
    dailyNotifications,
    dailyExecutions,
    deviceBreakdown,
  ] = await Promise.all([
    fetchPlatformKPIs(startDate, endDate),
    fetchBusinessKPIs(),
    fetchDailySubscribers(startDate, endDate),
    fetchDailyNotifications(startDate, endDate),
    fetchDailyExecutions(startDate, endDate),
    fetchDeviceBreakdown(),
  ]);

  return transformPushFireMetrics({
    platformKpis,
    businessKpis,
    dailySubscribers,
    dailyNotifications,
    dailyExecutions,
    deviceBreakdown,
    startDate,
    endDate,
  });
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PushFireMetrics>>> {
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

  const product = "pushfire";

  // Check cache
  try {
    const cached = await getCachedMetrics(product, start, end, METRIC_TYPE);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as PushFireMetrics,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data
    try {
      const { startDate, endDate } = parseDateRange(start, end);
      const metrics = await fetchAllMetrics(startDate, endDate);

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
      console.error("PushFire metrics fetch failed:", fetchError);

      // Serve stale cache as fallback
      if (cached.data) {
        return NextResponse.json({
          data: cached.data as unknown as PushFireMetrics,
          error: null,
          cached: true,
          cachedAt: cached.cachedAt,
        });
      }

      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch PushFire platform metrics",
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
      const metrics = await fetchAllMetrics(startDate, endDate);

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
          error: "Failed to fetch PushFire platform metrics",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  }
}
