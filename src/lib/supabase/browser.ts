import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | undefined;
export function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Account access is not configured yet.");
  if (!client) client = createClient(url, key);
  return client;
}
