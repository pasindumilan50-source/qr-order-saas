-- ============================================================================
-- 0008_restaurant_status_profile_rpc.sql
--
-- Same fix as 0005_restaurant_contact_update_rpc.sql, applied to the two
-- remaining direct-table writes against `restaurants` from the frontend:
--
--   - restaurantService.setRestaurantStatus()   -> supabase.from('restaurants').update({ is_active })
--   - restaurantService.updateRestaurantProfile() -> supabase.from('restaurants').update({ name, slug, ... })
--
-- Per 0005's reasoning, `restaurants` has no direct table-level UPDATE grant
-- for any client role by design (RLS + SECURITY DEFINER RPCs is the intended
-- access-control surface for this table, not table-level GRANTs), so these
-- direct `.update()` calls are liable to fail with "permission denied for
-- table restaurants" exactly as the Edge Function's equivalent call did.
--
-- Fix: two SECURITY DEFINER RPCs, authorized exactly like the existing
-- `restaurants_update_staff` RLS policy (super admin, or owner/admin of that
-- restaurant) and the `protect_restaurant_fields` trigger (is_active is
-- super-admin-only). No RLS policy, grant, or trigger is changed — this only
-- adds two callable functions.
-- ============================================================================

create or replace function public.set_restaurant_status(
  p_restaurant_id uuid,
  p_is_active     boolean
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin may change a restaurant''s status.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found.' using errcode = '22023';
  end if;

  update public.restaurants
     set is_active = p_is_active
   where id = p_restaurant_id
   returning * into v_restaurant;

  return v_restaurant;
end;
$$;

revoke all on function public.set_restaurant_status(uuid, boolean) from public;
grant execute on function public.set_restaurant_status(uuid, boolean) to authenticated;

create or replace function public.update_restaurant_profile(
  p_restaurant_id uuid,
  p_name          text default null,
  p_slug          text default null,
  p_address       text default null,
  p_phone         text default null,
  p_email         text default null,
  p_logo_url      text default null
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  if not (public.is_super_admin() or public.is_owner_or_admin_of(p_restaurant_id)) then
    raise exception 'Only a super admin or that restaurant''s owner/admin may update its profile.' using errcode = '42501';
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'Restaurant not found.' using errcode = '22023';
  end if;

  if p_name is not null and btrim(p_name) = '' then
    raise exception 'Restaurant name cannot be blank.' using errcode = '22023';
  end if;

  -- Only fields the caller actually supplied (non-null) are changed; this
  -- mirrors the frontend's existing partial-patch behavior (only keys
  -- present in the `fields` object were ever sent).
  update public.restaurants
     set name     = coalesce(p_name, name),
         slug     = coalesce(p_slug, slug),
         address  = coalesce(p_address, address),
         phone    = coalesce(p_phone, phone),
         email    = coalesce(p_email, email),
         logo_url = coalesce(p_logo_url, logo_url)
   where id = p_restaurant_id
   returning * into v_restaurant;

  return v_restaurant;
end;
$$;

revoke all on function public.update_restaurant_profile(uuid, text, text, text, text, text, text) from public;
grant execute on function public.update_restaurant_profile(uuid, text, text, text, text, text, text) to authenticated;
