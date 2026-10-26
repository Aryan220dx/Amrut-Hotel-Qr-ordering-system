import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveBrowserSupabaseUrl } from '../browser-supabase-url.mjs';

let browserClient: SupabaseClient | null = null;

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set the public URL and publishable key.");
  }

  const browserUrl = typeof window === "undefined" || process.env.NODE_ENV !== "development"
    ? url
    : resolveBrowserSupabaseUrl(url, window.location.origin);

  const create = () => createClient(browserUrl, key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });

  // Keep one auth/storage client per browser tab. Avoid sharing server-rendered auth state.
  if (typeof window === "undefined") return create();
  browserClient ??= create();
  return browserClient;
}
