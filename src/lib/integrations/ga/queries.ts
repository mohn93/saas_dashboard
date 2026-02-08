import { getGAClient } from "./client";
import { DateRange } from "@/lib/types";

function dateRangeToGA(range: DateRange) {
  return [{ startDate: range.start, endDate: range.end }];
}

export async function fetchKPIs(propertyId: string, range: DateRange) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    metrics: [
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
    ],
  });
  return response;
}

export async function fetchVisitorsOverTime(
  propertyId: string,
  range: DateRange
) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "sessions" },
    ],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
  });
  return response;
}

export async function fetchTopPages(propertyId: string, range: DateRange) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: 20,
  });
  return response;
}

export async function fetchReferrers(propertyId: string, range: DateRange) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 20,
  });
  return response;
}

export async function fetchCountryBreakdown(
  propertyId: string,
  range: DateRange
) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    dimensions: [{ name: "country" }, { name: "countryId" }],
    metrics: [{ name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    limit: 15,
  });
  return response;
}

export async function fetchDeviceBreakdown(
  propertyId: string,
  range: DateRange
) {
  const client = getGAClient();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRangeToGA(range),
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
  });
  return response;
}
