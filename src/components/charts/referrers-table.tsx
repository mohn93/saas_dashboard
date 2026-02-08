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
import type { ReferrerSource } from "@/lib/types";

interface ReferrersTableProps {
  data: ReferrerSource[];
  loading?: boolean;
  error?: string | null;
}

export function ReferrersTable({ data, loading, error }: ReferrersTableProps) {
  const maxSessions = Math.max(...data.map((r) => r.sessions), 1);

  return (
    <ChartWrapper
      title="Traffic Sources"
      description="Top referrers by sessions"
      loading={loading}
      error={error}
    >
      <div className="max-h-[320px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50">
              <TableHead className="text-xs uppercase tracking-wider">Source</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Medium</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">Sessions</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((ref, i) => (
              <TableRow key={i} className="border-border/30">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: `hsl(${(i * 50) % 360}, 70%, 60%)`,
                      }}
                    />
                    <span className="font-medium">{ref.source}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {ref.medium}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${(ref.sessions / maxSessions) * 100}%` }}
                      />
                    </div>
                    <span className="tabular-nums font-medium">{ref.sessions.toLocaleString()}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {ref.users.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
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
