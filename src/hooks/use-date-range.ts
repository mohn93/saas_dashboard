"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

const DEFAULT_DAYS = 30;

export function useDateRange() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const days = Number(searchParams.get("days")) || DEFAULT_DAYS;

  const setDays = useCallback(
    (newDays: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("days", String(newDays));
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const dateRange = {
    start: `${days}daysAgo`,
    end: "today",
  };

  return { days, setDays, dateRange };
}
