import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSomaraClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SOMARA_SUPABASE_URL;
  const key = process.env.SOMARA_SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("SOMARA_SUPABASE_URL and SOMARA_SUPABASE_SERVICE_KEY must be set");
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return client;
}
