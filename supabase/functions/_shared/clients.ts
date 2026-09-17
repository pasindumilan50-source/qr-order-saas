import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * A client scoped to the caller's own JWT. Every query made with this client
 * is subject to RLS exactly as if the caller had made it directly — this is
 * how we safely determine "is this caller actually a super admin / owner of
 * restaurant X" without trusting anything the request body claims.
 */
export function callerClient(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

/**
 * A client using the service_role key. NEVER exposed to the frontend — this
 * only ever runs inside this server-side Edge Function, sourced from a
 * function secret (`supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`).
 * Bypasses RLS, so every function using this client must independently
 * verify the caller's authorization first (via callerClient).
 */
export function serviceRoleClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getCallerProfile(req: Request) {
  const supabase = callerClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, restaurant_id, is_active')
    .eq('id', user.id)
    .maybeSingle();

  return { user, profile };
}
