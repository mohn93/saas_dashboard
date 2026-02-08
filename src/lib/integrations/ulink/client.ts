import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getULinkClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.ULINK_SUPABASE_URL;
  const key = process.env.ULINK_SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("ULINK_SUPABASE_URL and ULINK_SUPABASE_SERVICE_KEY must be set");
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return client;
}
