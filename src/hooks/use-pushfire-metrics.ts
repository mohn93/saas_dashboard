"use client";

import { useEffect, useState } from "react";
import type { ApiResponse, PushFireMetrics } from "@/lib/types";

interface UsePushFireMetricsResult {
  data: PushFireMetrics | null;
  loading: boolean;
  error: string | null;
  cached: boolean;
  cachedAt: string | null;
}

export function usePushFireMetrics(
  start: string,
  end: string
): UsePushFireMetricsResult {
  const [data, setData] = useState<PushFireMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!start || !end) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ start, end });

    fetch(`/api/metrics/pushfire?${params}`)
      .then((res) => res.json())
      .then((json: ApiResponse<PushFireMetrics>) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setData(null);
        } else {
          setData(json.data);
          setCached(json.cached);
          setCachedAt(json.cachedAt);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to fetch PushFire metrics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  return { data, loading, error, cached, cachedAt };
}
