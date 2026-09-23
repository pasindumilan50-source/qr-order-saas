// supabase/functions/update-staff-role/index.ts
//
// Owner only, own restaurant. Cannot change own role. Cannot grant/revoke
// "owner". Deploy: supabase functions deploy update-staff-role

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getCallerProfile, serviceRoleClient } from '../_shared/clients.ts';

const ALLOWED_ROLES = ['admin', 'kitchen', 'reception'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user, profile } = await getCallerProfile(req);
    if (!user) return jsonResponse({ error: 'Authentication required.' }, 401);
    if (!profile || profile.role !== 'owner' || !profile.is_active) {
      return jsonResponse({ error: 'Only the restaurant owner may change staff roles.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const staffId = String(body.staffId || '').trim();
    const role = String(body.role || '').trim();

    if (!staffId) return jsonResponse({ error: 'staffId is required.' }, 400);
    if (!ALLOWED_ROLES.includes(role)) return jsonResponse({ error: 'Role must be admin, kitchen, or reception.' }, 400);

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
      return jsonResponse({ error: 'You cannot change your own role.' }, 400);
    }
    if (target.role === 'owner') {
      return jsonResponse({ error: 'The restaurant owner\'s role cannot be changed here.' }, 400);
    }

    const { error: updStaffErr } = await admin.from('staff').update({ role }).eq('id', staffId);
    if (updStaffErr) return jsonResponse({ error: updStaffErr.message }, 400);

    await admin.from('profiles').update({ role }).eq('id', target.user_id);

    return jsonResponse({ success: true, staffId, role });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
