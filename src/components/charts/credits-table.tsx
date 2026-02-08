"use client";

import { ChartWrapper } from "./chart-wrapper";
import type { CreditsOverview } from "@/lib/types";

interface CreditsTableProps {
  data: CreditsOverview[];
  loading?: boolean;
  error?: string | null;
}

const labelMap: Record<string, string> = {
  subscription: "Subscription",
  purchase: "Purchase",
  bonus: "Bonus",
  rollover: "Rollover",
};

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function CreditsTable({ data, loading, error }: CreditsTableProps) {
  const totals = data.reduce(
    (acc, row) => ({
      granted: acc.granted + row.totalGranted,
      consumed: acc.consumed + row.totalConsumed,
      remaining: acc.remaining + row.totalRemaining,
    }),
    { granted: 0, consumed: 0, remaining: 0 }
  );

  return (
    <ChartWrapper
      title="Credits Overview"
      description="Credit allocation and consumption by source"
      loading={loading}
      error={error}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 text-right font-medium">Granted</th>
              <th className="pb-2 text-right font-medium">Consumed</th>
              <th className="pb-2 text-right font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.source} className="border-b last:border-0">
                <td className="py-2 font-medium">
                  {labelMap[row.source] || row.source}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(row.totalGranted)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(row.totalConsumed)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(row.totalRemaining)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right tabular-nums">
                {formatNumber(totals.granted)}
              </td>
              <td className="pt-2 text-right tabular-nums">
                {formatNumber(totals.consumed)}
              </td>
              <td className="pt-2 text-right tabular-nums">
                {formatNumber(totals.remaining)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ChartWrapper>
  );
}
