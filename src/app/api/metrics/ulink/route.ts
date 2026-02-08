import { NextRequest, NextResponse } from "next/server";
import { getProduct } from "@/lib/config/products";
import { fetchKPIs } from "@/lib/integrations/ga/queries";
import { transformKPIs } from "@/lib/integrations/ga/transform";
import {
  fetchSignups,
  fetchActiveSubscriptions,
  fetchMRROverTime,
} from "@/lib/integrations/ulink/queries";
import { transformBusinessMetrics } from "@/lib/integrations/ulink/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/integrations/supabase/cache";
import { parseDateRange } from "@/lib/utils/dates";
import type { ApiResponse, ULinkBusinessMetrics } from "@/lib/types";

const METRIC_TYPE = "ulink_business";

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<ULinkBusinessMetrics>>> {
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

  const product = "ulink";
  const productConfig = getProduct(product)!;

  // Check cache
  try {
    const cached = await getCachedMetrics(product, start, end, METRIC_TYPE);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as ULinkBusinessMetrics,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data
    try {
      const { startDate, endDate } = parseDateRange(start, end);

      const [signupsResult, subsResult, mrrTimeline, gaKpisRaw] =
        await Promise.all([
          fetchSignups(startDate, endDate),
          fetchActiveSubscriptions(),
          fetchMRROverTime(startDate, endDate),
          fetchKPIs(productConfig.gaPropertyId, { start, end }),
        ]);

      const gaKpis = transformKPIs(gaKpisRaw);

      const metrics = transformBusinessMetrics({
        signupsDaily: signupsResult.daily,
        totalSignups: signupsResult.total,
        subscriptions: subsResult.subscriptions,
        totalPaidUsers: subsResult.totalPaidUsers,
        mrrOverTime: mrrTimeline,
        gaVisitors: gaKpis.totalUsers,
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
      console.error("ULink metrics fetch failed:", fetchError);

      // Serve stale cache as fallback
      if (cached.data) {
        return NextResponse.json({
          data: cached.data as unknown as ULinkBusinessMetrics,
          error: null,
          cached: true,
          cachedAt: cached.cachedAt,
        });
      }

      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch ULink business metrics",
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

      const [signupsResult, subsResult, mrrTimeline, gaKpisRaw] =
        await Promise.all([
          fetchSignups(startDate, endDate),
          fetchActiveSubscriptions(),
          fetchMRROverTime(startDate, endDate),
          fetchKPIs(productConfig.gaPropertyId, { start, end }),
        ]);

      const gaKpis = transformKPIs(gaKpisRaw);

      const metrics = transformBusinessMetrics({
        signupsDaily: signupsResult.daily,
        totalSignups: signupsResult.total,
        subscriptions: subsResult.subscriptions,
        totalPaidUsers: subsResult.totalPaidUsers,
        mrrOverTime: mrrTimeline,
        gaVisitors: gaKpis.totalUsers,
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
          error: "Failed to fetch ULink business metrics",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  }
}
