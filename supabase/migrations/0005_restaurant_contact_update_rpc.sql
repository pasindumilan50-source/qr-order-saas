-- ============================================================================
-- 0005_restaurant_contact_update_rpc.sql
--
-- Fixes: "permission denied for table restaurants" when the
-- create-restaurant Edge Function tried to save address/phone/email with a
-- direct `admin.from('restaurants').update(...)` call. That call runs as
-- whatever database role backs the Supabase client performing it (anon,
-- authenticated, or service_role) and depends on that role's own
-- table-level GRANTs — which this project's migrations never explicitly
-- set up for `restaurants` (by design: see 0002_rls.sql, RLS + policies is
-- the intended access-control surface, not direct table grants).
--
-- Fix, in keeping with the rest of this schema's architecture
-- (create_restaurant / assign_restaurant_owner in 0003_functions.sql):
-- add a SECURITY DEFINER RPC. It runs with the privileges of its owner
-- (the migration-running role, which already has full rights on its own
-- tables) regardless of which role calls it, so no direct UPDATE grant on
-- `restaurants` ever needs to be handed to `authenticated` or
-- `service_role`. Authorization is enforced inside the function itself via
-- is_super_admin(), exactly like the existing RPCs — RLS on `restaurants`
-- is untouched and still applies to every other access path.
-- ============================================================================

create or replace function public.update_restaurant_contact_details(
  p_restaurant_id uuid,
  p_address       text default null,
  p_phone         text default null,
  p_email         text default null
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
    raise exception 'Only a super admin may update restaurant contact details.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found.' using errcode = '22023';
  end if;

  update public.restaurants
     set address = p_address,
         phone   = p_phone,
         email   = p_email
   where id = p_restaurant_id
   returning * into v_restaurant;

  return v_restaurant;
end;
$$;

-- Same grant shape as create_restaurant/assign_restaurant_owner: callable by
-- authenticated (and therefore by the service-role client, and by the
-- caller-scoped client used inside Edge Functions), never by anon/public.
-- is_super_admin() inside the function is what actually gates access — this
-- grant only controls who may attempt the call.
revoke all on function public.update_restaurant_contact_details(uuid, text, text, text) from public;
grant execute on function public.update_restaurant_contact_details(uuid, text, text, text) to authenticated;
