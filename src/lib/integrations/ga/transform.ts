import type {
  KPIs,
  DailyVisitors,
  TopPage,
  ReferrerSource,
  CountryBreakdown,
  DeviceBreakdown,
} from "@/lib/types";

interface GAMetricValue {
  value?: string | null;
}

interface GADimensionValue {
  value?: string | null;
}

interface GARow {
  metricValues?: GAMetricValue[] | null;
  dimensionValues?: GADimensionValue[] | null;
}

interface GAReportResponse {
  rows?: GARow[] | null;
}

function getMetricValue(row: GARow, index: number): number {
  return Number(row?.metricValues?.[index]?.value || 0);
}

function getDimensionValue(row: GARow, index: number): string {
  return String(row?.dimensionValues?.[index]?.value || "");
}

export function transformKPIs(response: GAReportResponse): KPIs {
  const row = response?.rows?.[0];
  if (!row) {
    return {
      totalUsers: 0,
      newUsers: 0,
      sessions: 0,
      pageviews: 0,
      avgSessionDuration: 0,
      bounceRate: 0,
    };
  }

  return {
    totalUsers: getMetricValue(row, 0),
    newUsers: getMetricValue(row, 1),
    sessions: getMetricValue(row, 2),
    pageviews: getMetricValue(row, 3),
    avgSessionDuration: getMetricValue(row, 4),
    bounceRate: getMetricValue(row, 5),
  };
}

export function transformVisitorsOverTime(
  response: GAReportResponse
): DailyVisitors[] {
  const rows = response?.rows || [];
  return rows.map((row) => ({
    date: getDimensionValue(row, 0),
    activeUsers: getMetricValue(row, 0),
    newUsers: getMetricValue(row, 1),
    sessions: getMetricValue(row, 2),
  }));
}

export function transformTopPages(response: GAReportResponse): TopPage[] {
  const rows = response?.rows || [];
  return rows.map((row) => ({
    pagePath: getDimensionValue(row, 0),
    pageTitle: getDimensionValue(row, 1),
    pageviews: getMetricValue(row, 0),
    users: getMetricValue(row, 1),
  }));
}

export function transformReferrers(
  response: GAReportResponse
): ReferrerSource[] {
  const rows = response?.rows || [];
  return rows.map((row) => ({
    source: getDimensionValue(row, 0),
    medium: getDimensionValue(row, 1),
    sessions: getMetricValue(row, 0),
    users: getMetricValue(row, 1),
  }));
}

export function transformCountryBreakdown(
  response: GAReportResponse
): CountryBreakdown[] {
  const rows = response?.rows || [];
  return rows.map((row) => ({
    country: getDimensionValue(row, 0),
    countryId: getDimensionValue(row, 1),
    users: getMetricValue(row, 0),
  }));
}

export function transformDeviceBreakdown(
  response: GAReportResponse
): DeviceBreakdown[] {
  const rows = response?.rows || [];
  return rows.map((row) => ({
    deviceCategory: getDimensionValue(row, 0),
    users: getMetricValue(row, 0),
  }));
}
