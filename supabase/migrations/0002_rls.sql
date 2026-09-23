-- ============================================================================
-- 0002_rls.sql
-- Helper functions + Row Level Security policies.
--
-- Design: role/restaurant_id are read LIVE from public.profiles on every
-- check (not cached from a JWT), via SECURITY DEFINER functions. This avoids
-- the classic "RLS policy on `profiles` recursively queries `profiles`"
-- problem, because these functions run with the privileges of their owner
-- and bypass RLS internally, while still being safely restricted to
-- read-only, single-row lookups keyed by auth.uid().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.get_my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.get_my_restaurant_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select restaurant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- The service_role key (used only server-side, by Edge Functions and
  -- trusted operator scripts — never the frontend) already bypasses RLS
  -- entirely at the database-role level. It still triggers BEFORE
  -- INSERT/UPDATE triggers, though, so it's treated as privileged here too
  -- for consistency — this does not grant it any access it didn't already
  -- have.
  select coalesce(auth.role() = 'service_role', false)
    or coalesce((select role from public.profiles where id = auth.uid()) = 'super_admin', false);
$$;

create or replace function public.is_anonymous_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function public.is_staff_of(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role in ('owner', 'admin', 'kitchen')
      and restaurant_id = target_restaurant_id
  );
$$;

create or replace function public.is_owner_or_admin_of(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role in ('owner', 'admin')
      and restaurant_id = target_restaurant_id
  );
$$;

create or replace function public.is_kitchen_of(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role = 'kitchen'
      and restaurant_id = target_restaurant_id
  );
$$;

revoke all on function public.get_my_role() from public;
revoke all on function public.get_my_restaurant_id() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_anonymous_user() from public;
revoke all on function public.is_staff_of(uuid) from public;
revoke all on function public.is_owner_or_admin_of(uuid) from public;
revoke all on function public.is_kitchen_of(uuid) from public;
grant execute on function public.get_my_role() to authenticated, anon;
grant execute on function public.get_my_restaurant_id() to authenticated, anon;
grant execute on function public.is_super_admin() to authenticated, anon;
grant execute on function public.is_anonymous_user() to authenticated, anon;
grant execute on function public.is_staff_of(uuid) to authenticated, anon;
grant execute on function public.is_owner_or_admin_of(uuid) to authenticated, anon;
grant execute on function public.is_kitchen_of(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Immutability guards — protected columns cannot be changed by ordinary
-- clients even though they technically have UPDATE rights on the row.
-- (Postgres RLS WITH CHECK cannot cleanly express "same as before" for a
-- self-referencing table, so this is enforced with BEFORE UPDATE triggers,
-- functionally equivalent to the original Firestore rule pattern of
-- comparing request.resource.data.X == resource.data.X.)
-- ---------------------------------------------------------------------------
create or replace function public.protect_restaurant_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_super_admin() then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot be changed';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'is_active can only be changed by a super admin';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_protect_fields on public.restaurants;
create trigger restaurants_protect_fields
  before update on public.restaurants
  for each row execute function public.protect_restaurant_fields();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_super_admin() then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'role cannot be self-assigned or changed by this user';
  end if;
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'restaurant_id cannot be changed by this user';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.block_privileged_self_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A brand-new profile row may only be inserted by a super admin (via the
  -- create_restaurant/invite flows), or, for the row's own id, with role
  -- left null (never a privileged role). This is the concrete enforcement
  -- of "a user must never be able to assign themselves super_admin".
  if public.is_super_admin() then
    return new;
  end if;
  if new.id = auth.uid() and new.role is null then
    return new;
  end if;
  raise exception 'insufficient privileges to create this profile';
end;
$$;

drop trigger if exists profiles_block_privileged_insert on public.profiles;
create trigger profiles_block_privileged_insert
  before insert on public.profiles
  for each row execute function public.block_privileged_self_insert();

create or replace function public.protect_customer_restaurant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id and not public.is_super_admin() then
    raise exception 'restaurant_id cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_protect_restaurant_id on public.customers;
create trigger customers_protect_restaurant_id
  before update on public.customers
  for each row execute function public.protect_customer_restaurant_id();

create or replace function public.protect_order_mutable_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Staff may only ever change `status` (and updated_at). Price/customer/
  -- table fields set at order-creation time are permanently locked, matching
  -- the original Cloud Function-only-writes-orders design.
  if public.is_super_admin() then
    return new;
  end if;
  if new.restaurant_id is distinct from old.restaurant_id
     or new.table_id is distinct from old.table_id
     or new.customer_id is distinct from old.customer_id
     or new.customer_uid is distinct from old.customer_uid
     or new.subtotal is distinct from old.subtotal
     or new.total is distinct from old.total
     or new.table_number is distinct from old.table_number
  then
    raise exception 'only order status may be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_protect_fields on public.orders;
create trigger orders_protect_fields
  before update on public.orders
  for each row execute function public.protect_order_mutable_fields();

-- ---------------------------------------------------------------------------
-- Enable RLS (default-deny once enabled with no matching policy)
-- ---------------------------------------------------------------------------
alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.tables enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.staff enable row level security;
alter table public.staff_invitations enable row level security;

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_select_public on public.restaurants;
create policy restaurants_select_public on public.restaurants
  for select using (true);
  -- Public read is required: the anonymous QR menu flow needs name/logo/
  -- is_active before the customer has any tenant-scoped session. This
  -- mirrors the original firestore.rules behavior.

drop policy if exists restaurants_insert_super_admin on public.restaurants;
create policy restaurants_insert_super_admin on public.restaurants
  for insert with check (public.is_super_admin());

drop policy if exists restaurants_update_staff on public.restaurants;
create policy restaurants_update_staff on public.restaurants
  for update using (public.is_super_admin() or public.is_owner_or_admin_of(id));

drop policy if exists restaurants_delete_super_admin on public.restaurants;
create policy restaurants_delete_super_admin on public.restaurants
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_super_admin on public.profiles;
create policy profiles_select_self_or_super_admin on public.profiles
  for select using (id = auth.uid() or public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid() or public.is_super_admin());
  -- Actual privilege enforcement (role/restaurant_id) happens in the
  -- profiles_block_privileged_insert trigger above.

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_super_admin());
  -- Field-level protection (role/restaurant_id immutability) is enforced by
  -- the profiles_protect_fields trigger above.

drop policy if exists profiles_delete_super_admin on public.profiles;
create policy profiles_delete_super_admin on public.profiles
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
drop policy if exists menu_items_select_public on public.menu_items;
create policy menu_items_select_public on public.menu_items
  for select using (true);
  -- Public read required for the anonymous QR menu.

drop policy if exists menu_items_insert_staff on public.menu_items;
create policy menu_items_insert_staff on public.menu_items
  for insert with check (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists menu_items_update_staff on public.menu_items;
create policy menu_items_update_staff on public.menu_items
  for update using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists menu_items_delete_staff on public.menu_items;
create policy menu_items_delete_staff on public.menu_items
  for delete using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
drop policy if exists tables_select_public on public.tables;
create policy tables_select_public on public.tables
  for select using (true);
  -- Public read required so a scanned QR can be validated before login.

drop policy if exists tables_insert_staff on public.tables;
create policy tables_insert_staff on public.tables
  for insert with check (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists tables_update_staff on public.tables;
create policy tables_update_staff on public.tables
  for update using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists tables_delete_staff on public.tables;
create policy tables_delete_staff on public.tables
  for delete using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- customers  (private — never public, never cross-tenant, never enumerable
-- by anonymous customers)
-- ---------------------------------------------------------------------------
drop policy if exists customers_select_staff on public.customers;
create policy customers_select_staff on public.customers
  for select using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists customers_insert_none on public.customers;
create policy customers_insert_none on public.customers
  for insert with check (public.is_super_admin());
  -- Ordinary writes happen only inside the create_order() SECURITY DEFINER
  -- function, which bypasses RLS by design.

drop policy if exists customers_update_staff on public.customers;
create policy customers_update_staff on public.customers
  for update using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists customers_delete_staff on public.customers;
create policy customers_delete_staff on public.customers
  for delete using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    public.is_super_admin()
    or public.is_staff_of(restaurant_id)
    or customer_uid = auth.uid()
  );
  -- Anonymous guests can only ever see their own order (auth.uid() match) —
  -- they cannot enumerate other orders because there is no policy granting
  -- broad SELECT to anonymous/authenticated roles.

drop policy if exists orders_insert_none on public.orders;
create policy orders_insert_none on public.orders
  for insert with check (public.is_super_admin());
  -- All customer-facing order creation goes through create_order(), which is
  -- SECURITY DEFINER and therefore bypasses this policy by design. Direct
  -- client INSERTs (which could carry a forged price) are always rejected.

drop policy if exists orders_update_staff on public.orders;
create policy orders_update_staff on public.orders
  for update using (public.is_super_admin() or public.is_staff_of(restaurant_id));
  -- Which fields may actually change is further restricted by the
  -- orders_protect_fields trigger (status only).

drop policy if exists orders_delete_super_admin on public.orders;
create policy orders_delete_super_admin on public.orders
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- order_items  (visibility follows the parent order; no direct writes)
-- ---------------------------------------------------------------------------
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          public.is_super_admin()
          or public.is_staff_of(o.restaurant_id)
          or o.customer_uid = auth.uid()
        )
    )
  );

drop policy if exists order_items_insert_none on public.order_items;
create policy order_items_insert_none on public.order_items
  for insert with check (public.is_super_admin());
  -- Written only inside create_order().

drop policy if exists order_items_no_update on public.order_items;
create policy order_items_no_update on public.order_items
  for update using (public.is_super_admin());

drop policy if exists order_items_no_delete on public.order_items;
create policy order_items_no_delete on public.order_items
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- staff  (mutations only via Edge Functions using the service role, which
-- bypasses RLS entirely and re-implements its own authorization checks —
-- see supabase/functions/*). Direct client writes are always denied.
-- ---------------------------------------------------------------------------
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists staff_insert_none on public.staff;
create policy staff_insert_none on public.staff
  for insert with check (public.is_super_admin());

drop policy if exists staff_update_none on public.staff;
create policy staff_update_none on public.staff
  for update using (public.is_super_admin());

drop policy if exists staff_delete_none on public.staff;
create policy staff_delete_none on public.staff
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- staff_invitations
-- ---------------------------------------------------------------------------
drop policy if exists staff_invitations_select on public.staff_invitations;
create policy staff_invitations_select on public.staff_invitations
  for select using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id));

drop policy if exists staff_invitations_write_none on public.staff_invitations;
create policy staff_invitations_write_none on public.staff_invitations
  for all using (public.is_super_admin()) with check (public.is_super_admin());
  -- Edge Functions (service role) write here directly, bypassing RLS.
