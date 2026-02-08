import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getPushFireClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.PUSHFIRE_SUPABASE_URL;
  const key = process.env.PUSHFIRE_SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("PUSHFIRE_SUPABASE_URL and PUSHFIRE_SUPABASE_SERVICE_KEY must be set");
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return client;
}
