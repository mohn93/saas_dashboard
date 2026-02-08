"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { format } from "date-fns";

const DEFAULT_DAYS = 30;

export function useDateRange() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const customStart = searchParams.get("start");
  const customEnd = searchParams.get("end");
  const isCustom = !!(customStart && customEnd);

  const days = isCustom ? 0 : Number(searchParams.get("days")) || DEFAULT_DAYS;

  const setDays = useCallback(
    (newDays: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("days", String(newDays));
      params.delete("start");
      params.delete("end");
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const setCustomRange = useCallback(
    (start: Date, end: Date) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("days");
      params.set("start", format(start, "yyyy-MM-dd"));
      params.set("end", format(end, "yyyy-MM-dd"));
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const dateRange = isCustom
    ? { start: customStart, end: customEnd }
    : { start: `${days}daysAgo`, end: "today" };

  return { days, setDays, setCustomRange, dateRange, isCustom, customStart, customEnd };
}
