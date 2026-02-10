import { Redis } from "@upstash/redis";

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

export async function getCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  metricType: string = "ga_bundle"
): Promise<{
  data: Record<string, unknown> | null;
  cachedAt: string | null;
  isStale: boolean;
}> {
  const key = `metrics:${product}:${metricType}:${dateStart}:${dateEnd}`;

  try {
    const cached = await getRedis().get<{
      payload: Record<string, unknown>;
      fetchedAt: string;
    }>(key);

    if (!cached) {
      return { data: null, cachedAt: null, isStale: true };
    }

    // With native TTL, if the key exists it's fresh
    return { data: cached.payload, cachedAt: cached.fetchedAt, isStale: false };
  } catch {
    return { data: null, cachedAt: null, isStale: true };
  }
}

export async function setCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  payload: unknown,
  metricType: string = "ga_bundle"
): Promise<void> {
  const key = `metrics:${product}:${metricType}:${dateStart}:${dateEnd}`;

  await getRedis().set(
    key,
    { payload, fetchedAt: new Date().toISOString() },
    { ex: CACHE_TTL_SECONDS }
  );
}
