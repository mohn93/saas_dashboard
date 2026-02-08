import { NextRequest, NextResponse } from "next/server";
import { fetchProjectHealth } from "@/lib/integrations/ulink/queries";
import { transformClientHealth } from "@/lib/integrations/ulink/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/integrations/supabase/cache";
import { parseDateRange } from "@/lib/utils/dates";
import type { ApiResponse, ULinkClientHealth } from "@/lib/types";

const METRIC_TYPE = "ulink_health";

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<ULinkClientHealth>>> {
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

  // Check cache
  try {
    const cached = await getCachedMetrics(product, start, end, METRIC_TYPE);

    if (cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as ULinkClientHealth,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    // Fetch fresh data
    try {
      const { startDate, endDate } = parseDateRange(start, end);
      const rawHealth = await fetchProjectHealth(startDate, endDate);
      const health = transformClientHealth(rawHealth);

      // Cache the result (fire and forget)
      setCachedMetrics(product, start, end, health, METRIC_TYPE).catch(
        console.error
      );

      return NextResponse.json({
        data: health,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch (fetchError) {
      console.error("ULink health fetch failed:", fetchError);

      // Serve stale cache as fallback
      if (cached.data) {
        return NextResponse.json({
          data: cached.data as unknown as ULinkClientHealth,
          error: null,
          cached: true,
          cachedAt: cached.cachedAt,
        });
      }

      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch ULink client health data",
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
      const rawHealth = await fetchProjectHealth(startDate, endDate);
      const health = transformClientHealth(rawHealth);

      return NextResponse.json({
        data: health,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch {
      return NextResponse.json(
        {
          data: null,
          error: "Failed to fetch ULink client health data",
          cached: false,
          cachedAt: null,
        },
        { status: 502 }
      );
    }
  }
}
