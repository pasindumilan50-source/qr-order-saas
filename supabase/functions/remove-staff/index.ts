// supabase/functions/remove-staff/index.ts
//
// Owner/Admin, own restaurant. Cannot remove self or the owner. Removes the
// staff row and detaches the profile from the restaurant (profile row is
// kept, not deleted, so historical order/report data referencing this user
// remains intact) and bans the auth user's existing sessions.
// Deploy: supabase functions deploy remove-staff

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getCallerProfile, serviceRoleClient } from '../_shared/clients.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user, profile } = await getCallerProfile(req);
    if (!user) return jsonResponse({ error: 'Authentication required.' }, 401);
    if (!profile || !['owner', 'admin'].includes(profile.role) || !profile.is_active) {
      return jsonResponse({ error: 'Only an active owner or admin may remove staff.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return jsonResponse({ error: 'staffId is required.' }, 400);

    const admin = serviceRoleClient();
    const { data: target, error: findErr } = await admin
      .from('staff')
      .select('id, restaurant_id, user_id, role')
      .eq('id', staffId)
      .maybeSingle();
    if (findErr || !target) return jsonResponse({ error: 'Staff member not found.' }, 404);
    if (target.restaurant_id !== profile.restaurant_id) {
      return jsonResponse({ error: 'That staff member does not belong to your restaurant.' }, 403);
    }
    if (target.user_id === user.id) {
      return jsonResponse({ error: 'You cannot remove yourself.' }, 400);
    }
    if (target.role === 'owner') {
      return jsonResponse({ error: 'The restaurant owner cannot be removed here.' }, 400);
    }

    await admin.from('staff').delete().eq('id', staffId);
    await admin.from('profiles').update({ role: null, restaurant_id: null, is_active: false }).eq('id', target.user_id);
    await admin.auth.admin.updateUserById(target.user_id, { ban_duration: '876000h' });

    return jsonResponse({ success: true, staffId });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
