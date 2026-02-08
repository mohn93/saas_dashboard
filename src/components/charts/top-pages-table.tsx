"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartWrapper } from "./chart-wrapper";
import type { TopPage } from "@/lib/types";

interface TopPagesTableProps {
  data: TopPage[];
  loading?: boolean;
  error?: string | null;
}

export function TopPagesTable({ data, loading, error }: TopPagesTableProps) {
  const maxViews = Math.max(...data.map((p) => p.pageviews), 1);

  return (
    <ChartWrapper title="Top Pages" description="Pages by pageviews" loading={loading} error={error}>
      <div className="max-h-[320px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50">
              <TableHead className="text-xs uppercase tracking-wider">Page</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">Views</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((page, i) => (
              <TableRow key={i} className="border-border/30">
                <TableCell>
                  <div className="max-w-[250px]">
                    <div className="truncate text-sm font-medium">{page.pagePath}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {page.pageTitle}
                    </div>
                    {/* Mini bar indicator */}
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${(page.pageviews / maxViews) * 100}%` }}
                      />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {page.pageviews.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {page.users.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No data available
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </ChartWrapper>
  );
}
