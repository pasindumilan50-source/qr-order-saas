import { supabase } from '../supabase/config';

export async function getPrinterSettings(restaurantId) {
  const { data, error } = await supabase
    .from('printer_settings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function savePrinterSettings(restaurantId, form) {
  const payload = {
    restaurant_id: restaurantId,
    name: form.name.trim(),
    connection_type: form.connectionType,
    brand: form.brand.trim(),
    model: form.model.trim() || null,
    ip_address:
      form.connectionType === 'usb'
        ? null
        : form.ipAddress.trim(),
    port:
      form.connectionType === 'usb'
        ? 9100
        : Number(form.port) || 9100,
    is_active: true,
  };

  const existing = await getPrinterSettings(restaurantId);

  if (existing) {
    const { data, error } = await supabase
      .from('printer_settings')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('printer_settings')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function disablePrinter(printerId) {
  const { error } = await supabase
    .from('printer_settings')
    .update({ is_active: false })
    .eq('id', printerId);

  if (error) throw error;
}
