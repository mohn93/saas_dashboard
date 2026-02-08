"use client";

import { useEffect, useState } from "react";
import type { ApiResponse, ULinkClientHealth } from "@/lib/types";

interface UseULinkHealthResult {
  data: ULinkClientHealth | null;
  loading: boolean;
  error: string | null;
}

export function useULinkHealth(
  start: string,
  end: string
): UseULinkHealthResult {
  const [data, setData] = useState<ULinkClientHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!start || !end) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ start, end });

    fetch(`/api/metrics/ulink/health?${params}`)
      .then((res) => res.json())
      .then((json: ApiResponse<ULinkClientHealth>) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setData(null);
        } else {
          setData(json.data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to fetch client health data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  return { data, loading, error };
}
