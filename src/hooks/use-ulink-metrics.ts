"use client";

import { useEffect, useState } from "react";
import type { ApiResponse, ULinkBusinessMetrics } from "@/lib/types";

interface UseULinkMetricsResult {
  data: ULinkBusinessMetrics | null;
  loading: boolean;
  error: string | null;
  cached: boolean;
  cachedAt: string | null;
}

export function useULinkMetrics(
  start: string,
  end: string
): UseULinkMetricsResult {
  const [data, setData] = useState<ULinkBusinessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    // Skip fetching when params are empty (non-ULink products)
    if (!start || !end) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ start, end });

    fetch(`/api/metrics/ulink?${params}`)
      .then((res) => res.json())
      .then((json: ApiResponse<ULinkBusinessMetrics>) => {
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
        setError(err.message || "Failed to fetch ULink metrics");
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
