// supabase/functions/set-staff-status/index.ts
//
// Owner/Admin, own restaurant. Cannot disable self or the owner. Also
// disables the underlying auth user so a disabled staff member's existing
// sessions/tokens stop working, not just their app-level access.
// Deploy: supabase functions deploy set-staff-status

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getCallerProfile, serviceRoleClient } from '../_shared/clients.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user, profile } = await getCallerProfile(req);
    if (!user) return jsonResponse({ error: 'Authentication required.' }, 401);
    if (!profile || !['owner', 'admin'].includes(profile.role) || !profile.is_active) {
      return jsonResponse({ error: 'Only an active owner or admin may change staff status.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const staffId = String(body.staffId || '').trim();
    const status = String(body.status || '').trim();
    if (!staffId) return jsonResponse({ error: 'staffId is required.' }, 400);
    if (!['active', 'disabled'].includes(status)) {
      return jsonResponse({ error: 'status must be active or disabled.' }, 400);
    }

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
      return jsonResponse({ error: 'You cannot change your own status.' }, 400);
    }
    if (target.role === 'owner') {
      return jsonResponse({ error: 'The restaurant owner\'s status cannot be changed here.' }, 400);
    }

    await admin.from('staff').update({ status }).eq('id', staffId);
    await admin.from('profiles').update({ is_active: status === 'active' }).eq('id', target.user_id);
    await admin.auth.admin.updateUserById(target.user_id, { ban_duration: status === 'disabled' ? '876000h' : 'none' });

    return jsonResponse({ success: true, staffId, status });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
