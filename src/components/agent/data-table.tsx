"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Maximize2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanizeIsoDate, pageBounds } from "@/lib/integrations/ulink-agent/format";
import type { QueryResult } from "@/lib/integrations/ulink-agent/types";

function renderCell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/40">—</span>;
  }

  // Humanize ISO dates/timestamps, with the exact date on hover (no raw ISO).
  const human = humanizeIsoDate(value);
  if (human) {
    return (
      <span
        title={human.exact}
        aria-label={human.exact}
        tabIndex={0}
        className="cursor-help whitespace-nowrap underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
      >
        {human.display}
      </span>
    );
  }

  if (typeof value === "object") {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }

  return <span>{String(value)}</span>;
}

// Plain-string form of a cell value, for the expand popup.
function cellFullText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

// A single-line, ellipsized cell. When the content is actually truncated, an
// expand icon appears on hover and opens a popup with the full value.
function TruncatedCell({ value }: { value: unknown }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = spanRef.current;
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, [value]);

  return (
    <div className="group/cell flex items-center gap-1">
      <span ref={spanRef} className="block max-w-[18rem] truncate">
        {renderCell(value)}
      </span>
      {overflowing && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Show full value"
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/cell:opacity-100 data-[state=open]:opacity-100"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 max-h-80 w-[min(28rem,90vw)] overflow-auto rounded-lg border border-border/50 bg-card p-3 shadow-lg"
            >
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                {cellFullText(value)}
              </pre>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}

// A result table with client-side pagination over the already-loaded rows.
// One component for both the inline (small pageSize) and fullscreen (large
// pageSize) views so cell rendering and paging behave identically in each.
export function PaginatedTable({
  result,
  pageSize,
}: {
  result: QueryResult;
  pageSize: number;
}) {
  const [page, setPage] = useState(0);
  const total = result.rows.length;
  const { page: cur, pageCount, start, end } = pageBounds(total, page, pageSize);

  // Reset to the first page when the underlying data changes (refresh, edit
  // query, switching widgets). Keyed on a cheap signature, not the object
  // reference, so a re-created-but-identical result doesn't churn the page.
  const sig = `${result.columns.join("|")}#${total}`;
  useEffect(() => setPage(0), [sig]);

  const rows = result.rows.slice(start, end);
  // A widget cached before the cap was raised can hold fewer rows than its true
  // count; surface that instead of implying the cached slice is everything.
  const capped = result.rowCount > total;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              {result.columns.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={start + i}>
                {result.columns.map((c) => (
                  <TableCell key={c}>
                    <TruncatedCell value={row[c]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span aria-live="polite">
          {total === 0
            ? "No rows"
            : `${(start + 1).toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
          {capped ? ` (of ${result.rowCount.toLocaleString()} total)` : " row" + (total === 1 ? "" : "s")}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(cur - 1)}
              disabled={cur === 0}
              aria-label="Previous page"
              className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              Page {cur + 1} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(cur + 1)}
              disabled={cur >= pageCount - 1}
              aria-label="Next page"
              className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
