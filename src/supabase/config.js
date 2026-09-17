import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missingKeys = REQUIRED.filter(
  (key) => !import.meta.env[key] || String(import.meta.env[key]).trim() === ''
);

export const isSupabaseConfigured = missingKeys.length === 0;
export const supabaseConfigMissingKeys = missingKeys;

let supabase = null;

if (isSupabaseConfigured) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
} else {
  // Do not throw at import time — the app renders a clear "missing
  // configuration" screen instead (see src/pages/Login.jsx).
  console.error(
    `[Supabase] Missing required environment variables: ${missingKeys.join(', ')}. ` +
      'Copy .env.example to .env and fill in your Supabase project URL/anon key.'
  );
}

export { supabase };

export function getAppBaseUrl() {
  return import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;
}
