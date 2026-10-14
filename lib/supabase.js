import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client;

// No secret/service-role key is used. Postgres checks every write against the
// signed-in user's identity, and the SDK refreshes their session automatically.
export function getSupabase() {
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}
