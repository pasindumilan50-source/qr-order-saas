-- ============================================================================
-- 0010_reception_billing_kot_workflow.sql
--
-- Phase 1 — Reception bill confirmation + KOT workflow foundation.
--
-- Business rule being implemented (see project brief for full detail):
--
--   guest -> QR order -> pending
--     -> Reception/Cashier checks the manual bill
--     -> ONE action: "Confirm Bill & Send KOT"
--          - confirms the bill (records who/when)
--          - logically issues the KOT (records who/when)
--          - moves the order to `confirmed`, now visible to Kitchen
--     -> confirmed -> preparing -> ready -> completed
--
-- No new order status is introduced. `orders.status` keeps its existing
-- values; the bill/KOT event is represented purely by four new nullable
-- audit columns. This migration is additive/idempotent (IF NOT EXISTS /
-- DROP+recreate for constraints, functions and policies only) and does not
-- touch 0001-0009.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Audit columns on orders — the KOT/bill event record.
--    Nullable: a freshly created `pending` order has not been bill-confirmed
--    yet. No existing financial column is touched or duplicated.
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists bill_confirmed_at timestamptz;
alter table public.orders add column if not exists bill_confirmed_by uuid references auth.users(id);
alter table public.orders add column if not exists kot_sent_at timestamptz;
alter table public.orders add column if not exists kot_sent_by uuid references auth.users(id);

-- Enforce "no bill confirmation -> no KOT" (and the "who" always travels
-- with the "when") at the data layer itself, not just inside the RPC below.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_bill_kot_consistency'
  ) then
    alter table public.orders add constraint orders_bill_kot_consistency check (
      (bill_confirmed_at is null) = (bill_confirmed_by is null)
      and (kot_sent_at is null) = (kot_sent_by is null)
      and (kot_sent_at is null or bill_confirmed_at is not null)
    );
  end if;
end $$;

create index if not exists orders_kitchen_visibility_idx
  on public.orders (restaurant_id, status, kot_sent_at);

-- ---------------------------------------------------------------------------
-- 2) Add the `reception` role across the existing role architecture.
--    Existing roles (super_admin, owner, admin, kitchen) are preserved.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role is null or role in ('super_admin', 'owner', 'admin', 'kitchen', 'reception'));

alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('owner', 'admin', 'kitchen', 'reception'));

alter table public.staff_invitations drop constraint if exists staff_invitations_role_check;
alter table public.staff_invitations add constraint staff_invitations_role_check
  check (role in ('admin', 'kitchen', 'reception'));

-- ---------------------------------------------------------------------------
-- 3) Role helper functions (mirrors is_kitchen_of / is_owner_or_admin_of from
--    0002_rls.sql). is_staff_of() is redefined in-place (CREATE OR REPLACE)
--    to also recognize `reception` as restaurant staff.
-- ---------------------------------------------------------------------------
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
      and role in ('owner', 'admin', 'kitchen', 'reception')
      and restaurant_id = target_restaurant_id
  );
$$;

create or replace function public.is_reception_of(target_restaurant_id uuid)
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
      and role = 'reception'
      and restaurant_id = target_restaurant_id
  );
$$;

revoke all on function public.is_reception_of(uuid) from public;
grant execute on function public.is_reception_of(uuid) to authenticated, anon;
-- is_staff_of(uuid) grants were already issued in 0002_rls.sql and are
-- preserved by CREATE OR REPLACE (re-issued below for a self-contained,
-- idempotent migration).
revoke all on function public.is_staff_of(uuid) from public;
grant execute on function public.is_staff_of(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4) Kitchen security: a `pending` guest order belongs to Reception until the
--    manual bill is confirmed. Kitchen must never see it — enforced here at
--    the RLS layer, not just by frontend filtering. Kitchen-visible orders
--    are `confirmed` (only once kot_sent_at is populated), `preparing`, or
--    `ready`. Owner/admin/reception keep full restaurant-scoped visibility
--    (reception needs to see incoming `pending` orders — that is their job).
-- ---------------------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    public.is_super_admin()
    or public.is_owner_or_admin_of(restaurant_id)
    or public.is_reception_of(restaurant_id)
    or (
      public.is_kitchen_of(restaurant_id)
      and status in ('confirmed', 'preparing', 'ready')
      and (status <> 'confirmed' or kot_sent_at is not null)
    )
    or customer_uid = auth.uid()
  );

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          public.is_super_admin()
          or public.is_owner_or_admin_of(o.restaurant_id)
          or public.is_reception_of(o.restaurant_id)
          or (
            public.is_kitchen_of(o.restaurant_id)
            and o.status in ('confirmed', 'preparing', 'ready')
            and (o.status <> 'confirmed' or o.kot_sent_at is not null)
          )
          or o.customer_uid = auth.uid()
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Close the generic "any staff can flip status to anything" direct-write
--    path. All workflow transitions now happen exclusively through the
--    SECURITY DEFINER RPCs below, each of which independently verifies
--    authentication, restaurant membership, role, and the exact required
--    prior status before mutating a single row inside one transaction.
--    (RPCs still function correctly despite this: SECURITY DEFINER runs
--    with the privileges of the function owner, which bypasses RLS here
--    exactly the way create_order() already bypasses the orders INSERT
--    policy — see 0002_rls.sql/0003_functions.sql.)
-- ---------------------------------------------------------------------------
drop policy if exists orders_update_staff on public.orders;
create policy orders_update_staff on public.orders
  for update using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6) confirm_bill_and_send_kot — the ONE Reception action.
--    Atomic: authenticate -> lock the row -> verify restaurant/role ->
--    verify status is exactly 'pending' -> flip everything in one UPDATE.
--    Row-locked via `for update`, so two concurrent calls on the same order
--    cannot both succeed: the second blocks until the first commits, then
--    fails the "must be pending" check safely (no duplicate KOT).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_bill_and_send_kot(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_reception_of(v_order.restaurant_id)
    or public.is_owner_or_admin_of(v_order.restaurant_id)
  ) then
    raise exception 'Only Reception, an admin, or the owner may confirm the bill and send the KOT.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'This order is no longer pending (current status: %). It cannot be bill-confirmed again.', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'confirmed',
         bill_confirmed_at = now(),
         bill_confirmed_by = v_uid,
         kot_sent_at = now(),
         kot_sent_by = v_uid,
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.confirm_bill_and_send_kot(uuid) from public;
grant execute on function public.confirm_bill_and_send_kot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Kitchen transition RPCs — explicit, one-status-at-a-time, instead of a
--    generic status setter. Each locks the row, checks restaurant/role, and
--    requires the exact previous status (confirmed+KOT -> preparing ->
--    ready -> completed). `pending -> preparing` (or any other skip) is
--    impossible because the required prior status never matches.
-- ---------------------------------------------------------------------------
create or replace function public.start_order_preparing(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_order.restaurant_id)
    or public.is_owner_or_admin_of(v_order.restaurant_id)
  ) then
    raise exception 'Only Kitchen, an admin, or the owner may start preparing this order.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'confirmed' or v_order.kot_sent_at is null then
    raise exception 'Order must be confirmed with an issued KOT before preparing can start (current status: %).', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'preparing',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.mark_order_ready(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_order.restaurant_id)
    or public.is_owner_or_admin_of(v_order.restaurant_id)
  ) then
    raise exception 'Only Kitchen, an admin, or the owner may mark this order ready.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'preparing' then
    raise exception 'Order must be preparing before it can be marked ready (current status: %).', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'ready',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.complete_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_order.restaurant_id)
    or public.is_owner_or_admin_of(v_order.restaurant_id)
  ) then
    raise exception 'Only Kitchen, an admin, or the owner may complete this order.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'ready' then
    raise exception 'Order must be ready before it can be completed (current status: %).', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'completed',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.start_order_preparing(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from public;
revoke all on function public.complete_order(uuid) from public;
grant execute on function public.start_order_preparing(uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;
grant execute on function public.complete_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) cancel_order — replaces the old "update status to cancelled via the
--    generic setter" path. A `pending` order still belongs to Reception (not
--    yet handed to Kitchen), so Kitchen may not cancel it; once bill-
--    confirmed, any restaurant staff member may cancel, matching prior
--    behavior.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if v_order.status = 'pending' then
    if not (
      public.is_super_admin()
      or public.is_reception_of(v_order.restaurant_id)
      or public.is_owner_or_admin_of(v_order.restaurant_id)
    ) then
      raise exception 'Only Reception, an admin, or the owner may cancel a pending order.'
        using errcode = '42501';
    end if;
  else
    if not (public.is_super_admin() or public.is_staff_of(v_order.restaurant_id)) then
      raise exception 'You may not act on orders belonging to another restaurant.'
        using errcode = '42501';
    end if;
  end if;

  if v_order.status in ('completed', 'cancelled') then
    raise exception 'This order is already % and cannot be cancelled.', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status = 'cancelled',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.cancel_order(uuid) from public;
grant execute on function public.cancel_order(uuid) to authenticated;
