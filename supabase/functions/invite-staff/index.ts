// supabase/functions/invite-staff/index.ts
//
// Owner/Admin only, scoped to their own restaurant. Invites (or reuses) a
// Supabase Auth account for the new staff member, then creates their
// profile + staff row with the requested role (admin or kitchen — never
// owner or super_admin via this path).
//
// Deploy: supabase functions deploy invite-staff

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getCallerProfile, serviceRoleClient } from '../_shared/clients.ts';

const ALLOWED_ROLES = ['admin', 'kitchen', 'reception'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user, profile } = await getCallerProfile(req);
    if (!user) return jsonResponse({ error: 'Authentication required.' }, 401);
    if (!profile || !['owner', 'admin'].includes(profile.role) || !profile.is_active) {
      return jsonResponse({ error: 'Only an active owner or admin may invite staff.' }, 403);
    }
    if (!profile.restaurant_id) {
      return jsonResponse({ error: 'Your account is not linked to a restaurant.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const name = body.name ? String(body.name).trim() : null;
    const role = String(body.role || '').trim();

    if (!email) return jsonResponse({ error: 'Email is required.' }, 400);
    if (!ALLOWED_ROLES.includes(role)) {
      return jsonResponse({ error: 'Role must be admin, kitchen, or reception.' }, 400);
    }

    const restaurantId = profile.restaurant_id;
    const admin = serviceRoleClient();

    let staffUserId: string;
    const invited = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: name || undefined } });
    if (invited.error) {
      const { data: page, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (listErr) return jsonResponse({ error: `Could not invite or locate user: ${invited.error.message}` }, 400);
      const existing = page.users.find((u) => u.email?.toLowerCase() === email);
      if (!existing) return jsonResponse({ error: `Could not invite: ${invited.error.message}` }, 400);
      staffUserId = existing.id;
    } else {
      staffUserId = invited.data.user.id;
    }

    // Never let this path touch someone who already has a DIFFERENT
    // restaurant's staff role, and never allow escalation to owner/super_admin.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, role, restaurant_id')
      .eq('id', staffUserId)
      .maybeSingle();

    if (existingProfile?.role === 'super_admin') {
      return jsonResponse({ error: 'This user cannot be added as restaurant staff.' }, 400);
    }
    if (existingProfile?.restaurant_id && existingProfile.restaurant_id !== restaurantId) {
      return jsonResponse({ error: 'This user already belongs to a different restaurant.' }, 400);
    }

    const { error: upsertProfileErr } = await admin.from('profiles').upsert(
      {
        id: staffUserId,
        restaurant_id: restaurantId,
        role,
        full_name: name,
        email,
        is_active: true,
      },
      { onConflict: 'id' }
    );
    if (upsertProfileErr) return jsonResponse({ error: upsertProfileErr.message }, 400);

    const { data: staffRow, error: upsertStaffErr } = await admin
      .from('staff')
      .upsert(
        { restaurant_id: restaurantId, user_id: staffUserId, name, email, role, status: 'active' },
        { onConflict: 'restaurant_id,user_id' }
      )
      .select()
      .single();
    if (upsertStaffErr) return jsonResponse({ error: upsertStaffErr.message }, 400);

    return jsonResponse({ staff: staffRow, invited: !invited.error });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
