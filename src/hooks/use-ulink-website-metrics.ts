"use client";

import { useEffect, useState } from "react";
import type { ApiResponse, GAMetricsBundle } from "@/lib/types";

interface UseULinkWebsiteMetricsResult {
  data: GAMetricsBundle | null;
  loading: boolean;
  error: string | null;
  cached: boolean;
  cachedAt: string | null;
}

export function useULinkWebsiteMetrics(
  start: string,
  end: string
): UseULinkWebsiteMetricsResult {
  const [data, setData] = useState<GAMetricsBundle | null>(null);
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

    fetch(`/api/metrics/ulink/website?${params}`)
      .then((res) => res.json())
      .then((json: ApiResponse<GAMetricsBundle>) => {
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
        setError(err.message || "Failed to fetch website metrics");
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
