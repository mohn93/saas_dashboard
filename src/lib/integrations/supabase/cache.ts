import { getSupabaseClient } from "./client";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheRow {
  payload: unknown;
  fetched_at: string;
}

export async function getCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  metricType: string = "ga_bundle"
): Promise<{ data: Record<string, unknown> | null; cachedAt: string | null; isStale: boolean }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("metrics_cache")
    .select("payload, fetched_at")
    .eq("product", product)
    .eq("metric_type", metricType)
    .eq("date_start", dateStart)
    .eq("date_end", dateEnd)
    .single();

  if (error || !data) {
    return { data: null, cachedAt: null, isStale: true };
  }

  const row = data as CacheRow;
  const fetchedAt = new Date(row.fetched_at).getTime();
  const isStale = Date.now() - fetchedAt > CACHE_TTL_MS;

  return {
    data: row.payload as Record<string, unknown>,
    cachedAt: row.fetched_at,
    isStale,
  };
}

export async function setCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  payload: unknown,
  metricType: string = "ga_bundle"
): Promise<void> {
  const supabase = getSupabaseClient();

  await supabase.from("metrics_cache").upsert(
    {
      product,
      metric_type: metricType,
      date_start: dateStart,
      date_end: dateEnd,
      payload,
      fetched_at: new Date().toISOString(),
    },
    {
      onConflict: "product,metric_type,date_start,date_end",
    }
  );
}
