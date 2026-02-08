import { subDays, startOfDay, endOfDay } from "date-fns";

/**
 * Converts GA-style date strings ("30daysAgo", "today") to Date objects.
 */
export function parseDateRange(
  start: string,
  end: string
): { startDate: Date; endDate: Date } {
  const now = new Date();

  function parseToken(token: string): Date {
    if (token === "today") {
      return endOfDay(now);
    }
    if (token === "yesterday") {
      return endOfDay(subDays(now, 1));
    }
    const match = token.match(/^(\d+)daysAgo$/);
    if (match) {
      return startOfDay(subDays(now, parseInt(match[1], 10)));
    }
    // Assume ISO date string
    return new Date(token);
  }

  return {
    startDate: parseToken(start),
    endDate: parseToken(end),
  };
}
