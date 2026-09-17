// supabase/functions/create-restaurant/index.ts
//
// Super Admin only. Creates a restaurant and creates the owner's Supabase
// Auth account directly (no invitation email — avoids Supabase Auth's email
// rate limit), then links them as the restaurant's owner via the
// create_restaurant() / assign_restaurant_owner() RPCs.
//
// Deploy: supabase functions deploy create-restaurant
// Secrets required (function-scoped, never in frontend bundle):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getCallerProfile, serviceRoleClient, callerClient } from '../_shared/clients.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Generates a cryptographically-random temporary password server-side.
// Only used as a fallback when the caller doesn't supply one; the Super
// Admin normally sets this in the form themselves so it never needs to be
// echoed back in the response.
function generateTempPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, 'A').replace(/\//g, 'b').replace(/=/g, '');
  // Guarantee at least one digit and one uppercase letter so it always
  // satisfies typical password policies, without weakening the entropy.
  return `${b64.slice(0, 20)}9Q`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user, profile } = await getCallerProfile(req);
    if (!user) return jsonResponse({ error: 'Authentication required.' }, 401);
    if (!profile || profile.role !== 'super_admin') {
      return jsonResponse({ error: 'Only a super admin may create a restaurant.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const address = body.address ? String(body.address).trim() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const ownerName = body.ownerName ? String(body.ownerName).trim() : null;
    const ownerEmail = body.ownerEmail ? String(body.ownerEmail).trim().toLowerCase() : '';
    const ownerPassword = body.ownerPassword ? String(body.ownerPassword) : '';

    // --- Validation -----------------------------------------------------
    if (!name || name.length < 2 || name.length > 120) {
      return jsonResponse({ error: 'Restaurant name must be between 2 and 120 characters.' }, 400);
    }
    if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
      return jsonResponse({ error: 'A valid owner email address is required.' }, 400);
    }
    if (ownerPassword && ownerPassword.length < MIN_PASSWORD_LENGTH) {
      return jsonResponse({ error: `Owner password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    const admin = serviceRoleClient();
    const password = ownerPassword || generateTempPassword();

    // --- Step 1: create the owner's Auth account directly ---------------
    // No invitation email is sent. email_confirm: true marks them verified
    // immediately so they can sign in with the password right away.
    const created = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: ownerName ? { full_name: ownerName } : undefined,
    });

    if (created.error) {
      const msg = created.error.message || 'Could not create the owner account.';
      const isDuplicate = /already been registered|already exists|already registered/i.test(msg);
      return jsonResponse(
        {
          error: isDuplicate
            ? `An account with the email "${ownerEmail}" already exists. Use a different email, or ask the owner to be added via staff management instead.`
            : `Could not create owner account: ${msg}`,
        },
        400
      );
    }

    const ownerId = created.data.user.id;

    // --- Step 2: create the restaurant + assign the owner ----------------
    // Uses the caller-scoped client so create_restaurant()'s own
    // is_super_admin() check runs against the real caller (defense in
    // depth — not just this function's own role check above). The RPC
    // inserts the restaurant AND assigns the owner (profile + staff row,
    // role hard-coded to 'owner') inside a single Postgres function call,
    // so that half of the operation can never persist without the other.
    const caller = callerClient(req);
    const { data: restaurant, error: rpcError } = await caller.rpc('create_restaurant', {
      p_name: name,
      p_slug: null,
      p_owner_id: ownerId,
    });

    if (rpcError) {
      // Roll back the auth account we just created so a failed restaurant
      // creation never leaves an orphaned owner account with nowhere to
      // belong, and a retry with the same email doesn't fail as "duplicate".
      await admin.auth.admin.deleteUser(ownerId).catch(() => {
        /* best-effort rollback; surfaced error below still tells the caller what happened */
      });
      return jsonResponse({ error: `Could not create restaurant: ${rpcError.message}` }, 400);
    }

    // --- Step 3: best-effort extra restaurant fields ---------------------
    // Restaurant + owner are already fully consistent at this point; these
    // are cosmetic fields, so a failure here is surfaced but non-fatal.
    //
    // This goes through the update_restaurant_contact_details() SECURITY
    // DEFINER RPC (see migration 0005) rather than a direct
    // `.from('restaurants').update(...)` table write. `restaurants` has no
    // direct table-level UPDATE grant for any client role by design — RLS +
    // this RPC architecture is the access-control surface, matching
    // create_restaurant()/assign_restaurant_owner() above. A raw table
    // write here would fail with "permission denied for table restaurants"
    // regardless of which client (service-role or caller-scoped) performs
    // it, since neither role holds that grant.
    let detailsWarning: string | null = null;
    if (address || phone || email) {
      const { error: updateErr } = await caller.rpc('update_restaurant_contact_details', {
        p_restaurant_id: restaurant.id,
        p_address: address,
        p_phone: phone,
        p_email: email,
      });
      if (updateErr) detailsWarning = `Restaurant created, but saving address/phone/email failed: ${updateErr.message}`;
    }

    // Never return the password — the Super Admin already has it (either
    // they typed it into the form, or they're relying on out-of-band
    // sharing); the API response only confirms what happened.
    return jsonResponse({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
      },
      ownerEmail,
      ownerAccountCreated: true,
      warning: detailsWarning,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
