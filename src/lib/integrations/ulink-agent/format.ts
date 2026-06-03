import { format, parseISO, isValid } from "date-fns";

// ISO date or datetime, e.g. "2026-05-06" or "2026-05-06T04:44:25.000Z".
export const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export interface HumanDate {
  display: string; // short, human form for the cell/tick
  exact: string; // full, unambiguous form for tooltip/aria
}

// Humanized + exact forms of an ISO date/datetime string, or null when the
// value isn't an ISO date. One definition shared by the table cells and the
// chart x-axis so a date renders the same way everywhere (no raw ISO leaks).
export function humanizeIsoDate(value: unknown): HumanDate | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null;
  const d = parseISO(value);
  if (!isValid(d)) return null;
  const hasTime = /[T ]\d{2}:\d{2}/.test(value);
  return {
    display: hasTime ? format(d, "MMM d, yyyy, h:mm a") : format(d, "MMM d, yyyy"),
    exact: hasTime
      ? format(d, "EEEE, MMMM d, yyyy 'at' h:mm:ss a")
      : format(d, "EEEE, MMMM d, yyyy"),
  };
}

// Compact label for a chart x value: a date-only form for ISO dates, otherwise
// the plain string. Chart ticks read "Aug 29, 2025" instead of
// "2025-08-29T00:00:00.000Z"; the time is dropped (axes bucket by day/week/
// month, and a TZ-shifted midnight rendering "2:00 AM" only adds noise).
export function axisLabel(value: unknown): string {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = parseISO(value);
    if (isValid(d)) return format(d, "MMM d, yyyy");
  }
  return value == null ? "" : String(value);
}

export interface PageBounds {
  page: number; // clamped page index (0-based)
  pageCount: number; // total number of pages (>= 1)
  start: number; // first row index on the page (0-based, inclusive)
  end: number; // one past the last row index on the page (exclusive)
}

// Clamp a requested page and compute the row-slice bounds for client-side
// pagination over an already-loaded result set. Always returns at least one
// page so an empty result still renders a stable (empty) view.
export function pageBounds(totalRows: number, page: number, pageSize: number): PageBounds {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(totalRows / size));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  const start = clamped * size;
  const end = Math.min(start + size, totalRows);
  return { page: clamped, pageCount, start, end };
}
