import { createClient } from '@supabase/supabase-js';

// Authentication model (see README "Authentication model" for the full
// explanation): the bridge signs in as a real Supabase Auth user — the
// SAME mechanism the Reception/Kitchen dashboards use — rather than using
// a service_role key. claim_kot_print_job / mark_kot_print_job_printed /
// mark_kot_print_job_failed all resolve auth.uid() against `profiles` and
// require role 'kitchen', 'owner', 'admin', or 'super_admin' for the
// job's restaurant. A dedicated staff-like account scoped to this one
// restaurant is the least-privileged way to satisfy that.

export function createSupabaseClient({ url, anonKey }) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function authenticate(client, { email, password }, logger) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Bridge authentication failed: ${error.message}`);
  }
  logger?.info('bridge_authenticated', { userId: data.user?.id });
  return data.user;
}
