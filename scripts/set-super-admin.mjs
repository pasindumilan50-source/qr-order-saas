#!/usr/bin/env node
/**
 * One-time bootstrap: promote an existing Supabase Auth user to super_admin.
 *
 * Usage:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=xxxx \
 *   node scripts/set-super-admin.mjs owner@example.com
 *
 * The service-role key is read from the environment ONLY — never hardcode
 * it here, never commit it, and never expose it to the frontend bundle.
 * This script talks directly to Supabase (bypassing RLS via service_role),
 * which is the one legitimate reason to use that key outside an Edge
 * Function: a trusted operator running it locally/in CI, once.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment first.');
  process.exit(1);
}
if (!email) {
  console.error('Usage: node scripts/set-super-admin.mjs <email>');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: page, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;

  let user = page.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!user) {
    console.log(`No existing user for ${email} — inviting them now.`);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) throw error;
    user = data.user;
  }

  // Directly upsert via the service-role client — this bypasses RLS, which
  // is exactly why this script must only ever be run by a trusted operator
  // with the service_role key, never shipped as an app feature.
  const { error: upsertErr } = await admin.from('profiles').upsert(
    {
      id: user.id,
      role: 'super_admin',
      restaurant_id: null,
      email,
      is_active: true,
    },
    { onConflict: 'id' }
  );
  if (upsertErr) throw upsertErr;

  console.log(`✅ ${email} (${user.id}) is now a super_admin.`);
}

main().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
