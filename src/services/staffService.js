import { supabase } from '../supabase/config';

function toStaff(row) {
  return {
    id: row.id,
    staffId: row.id,
    restaurantId: row.restaurant_id,
    userId: row.user_id,
    name: row.name || '',
    email: row.email || '',
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listenStaff(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toStaff));
  }

  fetchAll();

  const channel = supabase
    .channel(`staff-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'staff', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

async function invokeStaffFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch {
      /* fall back to error.message */
    }
    throw new Error(message || 'Request failed.');
  }
  return data;
}

export async function inviteStaff(email, name, role) {
  return invokeStaffFunction('invite-staff', { email, name, role });
}

export async function updateStaffRole(staffId, role) {
  return invokeStaffFunction('update-staff-role', { staffId, role });
}

export async function setStaffStatus(staffId, status) {
  return invokeStaffFunction('set-staff-status', { staffId, status });
}

export async function removeStaff(staffId) {
  return invokeStaffFunction('remove-staff', { staffId });
}
