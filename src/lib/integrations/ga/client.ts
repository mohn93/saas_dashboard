import { BetaAnalyticsDataClient } from "@google-analytics/data";

let client: BetaAnalyticsDataClient | null = null;

export function getGAClient(): BetaAnalyticsDataClient {
  if (client) return client;

  const base64Json = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!base64Json) {
    throw new Error("GA_SERVICE_ACCOUNT_JSON environment variable is not set");
  }

  const credentials = JSON.parse(
    Buffer.from(base64Json, "base64").toString("utf-8")
  );

  client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
  });

  return client;
}
