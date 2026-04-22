import { NextRequest, NextResponse } from "next/server";
import { getProduct } from "@/lib/config/products";
import { fetchKPIs } from "@/lib/integrations/ga/queries";
import { transformKPIs } from "@/lib/integrations/ga/transform";
import {
  fetchSignups,
  fetchActiveSubscriptions,
  fetchActiveProjects,
  fetchPaidCohortCount,
} from "@/lib/integrations/ulink/queries";
import { transformBusinessMetrics } from "@/lib/integrations/ulink/transform";
import {
  getCachedMetrics,
  setCachedMetrics,
} from "@/lib/cache/kv";
import { parseDateRange } from "@/lib/utils/dates";
import type {
  ApiResponse,
  ProductConfig,
  ULinkBusinessMetrics,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const METRIC_TYPE = "ulink_business";

async function computeFreshMetrics(
  start: string,
  end: string,
  productConfig: ProductConfig
): Promise<ULinkBusinessMetrics> {
  const { startDate, endDate } = parseDateRange(start, end);

  const [signupsResult, subsResult, gaKpisRaw, activeProjects, paidInCohort] =
    await Promise.all([
      fetchSignups(startDate, endDate),
      fetchActiveSubscriptions(),
      fetchKPIs(productConfig.gaPropertyId, { start, end }),
      fetchActiveProjects(startDate, endDate),
      fetchPaidCohortCount(startDate, endDate),
    ]);

  const gaKpis = transformKPIs(gaKpisRaw);

  return transformBusinessMetrics({
    signupsDaily: signupsResult.daily,
    totalSignups: signupsResult.total,
    subscriptions: subsResult.subscriptions,
    totalPaidUsers: subsResult.totalPaidUsers,
    paidInCohort,
    activeProjects,
    gaVisitors: gaKpis.totalUsers,
    startDate,
    endDate,
  });
}

function errorResponse(): NextResponse<ApiResponse<ULinkBusinessMetrics>> {
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
  const fresh = searchParams.get("fresh") === "true";

  try {
    const cached = await getCachedMetrics(product, start, end, METRIC_TYPE);

    if (!fresh && cached.data && !cached.isStale) {
      return NextResponse.json({
        data: cached.data as unknown as ULinkBusinessMetrics,
        error: null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }

    try {
      const metrics = await computeFreshMetrics(start, end, productConfig);

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

      return errorResponse();
    }
  } catch (cacheError) {
    console.error("Cache check failed:", cacheError);

    // Cache layer is down; fetch directly without caching.
    try {
      const metrics = await computeFreshMetrics(start, end, productConfig);
      return NextResponse.json({
        data: metrics,
        error: null,
        cached: false,
        cachedAt: null,
      });
    } catch {
      return errorResponse();
    }
  }
}
