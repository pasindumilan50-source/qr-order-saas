-- ============================================================================
-- 0012_kot_print_queue.sql
--
-- Phase 3 — KOT Print Queue foundation.
--
-- This migration does NOT talk to a physical printer. It creates a durable,
-- restaurant-isolated queue (`kot_print_jobs`) that a future Local Print
-- Bridge will poll/claim and eventually push to each restaurant's existing
-- KOT printer over ESC/POS or similar. Phase 3 ends at the queue itself.
--
-- Business event this hooks into (Phase 1/2, unchanged):
--
--   Reception clicks "Confirm Bill & Send KOT"
--        -> confirm_bill_and_send_kot(order_id, bill_reference)
--        -> order becomes `confirmed`, bill_confirmed_*/kot_sent_* populated
--
-- This migration extends that SAME atomic RPC (same transaction, same
-- single Reception action — no new button, no separate frontend call) so
-- that a `kot_print_jobs` row is created in one step. If the frontend
-- crashes immediately after the RPC call returns, the KOT job already
-- exists in the database — it does not depend on a second network request.
--
-- Does not touch 0001-0011. Additive/idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) kot_print_jobs — one row per issued KOT.
--
--    `kot_snapshot` freezes exactly what Kitchen was told to prepare at the
--    moment the KOT was issued (restaurant/table/order-time/items/notes).
--    If the order record is ever touched again later, this snapshot still
--    reflects what was actually sent to Kitchen. It intentionally excludes
--    price/subtotal/total — a KOT is a kitchen ticket, not a bill, and this
--    project already has a bill/financial trail on `orders` itself.
--
--    `status` is a small, closed set. `attempt_count` / `last_error` /
--    `failed_at` exist so a future Print Bridge has somewhere to report
--    retry/failure information — no retry scheduling is implemented here.
-- ---------------------------------------------------------------------------
create table if not exists public.kot_print_jobs (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  order_id       uuid not null references public.orders(id) on delete cascade,
  status         text not null default 'queued',
  kot_snapshot   jsonb not null,
  attempt_count  integer not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  queued_at      timestamptz not null default now(),
  claimed_at     timestamptz,
  printed_at     timestamptz,
  failed_at      timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kot_print_jobs_status_check') then
    alter table public.kot_print_jobs add constraint kot_print_jobs_status_check
      check (status in ('queued', 'printing', 'printed', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kot_print_jobs_attempt_count_nonneg') then
    alter table public.kot_print_jobs add constraint kot_print_jobs_attempt_count_nonneg
      check (attempt_count >= 0);
  end if;
end $$;

-- Section 9 — restaurant isolation: a job's restaurant_id must always match
-- its order's restaurant_id. A plain CHECK constraint cannot look at another
-- table, so this is enforced with a small BEFORE INSERT/UPDATE trigger —
-- the same technique 0002_rls.sql already uses for field-immutability
-- guards. This closes off any path (including a future manual INSERT by a
-- super admin) that could create a cross-restaurant job.
create or replace function public.check_kot_print_job_restaurant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_restaurant_id uuid;
begin
  select restaurant_id into v_order_restaurant_id from public.orders where id = new.order_id;
  if v_order_restaurant_id is null then
    raise exception 'Order not found for KOT print job.' using errcode = '22023';
  end if;
  if v_order_restaurant_id <> new.restaurant_id then
    raise exception 'KOT print job restaurant_id must match the order''s restaurant_id.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists kot_print_jobs_check_restaurant on public.kot_print_jobs;
create trigger kot_print_jobs_check_restaurant
  before insert or update of restaurant_id, order_id on public.kot_print_jobs
  for each row execute function public.check_kot_print_job_restaurant();

-- Section 4/15 — idempotency / duplicate protection at the database level.
-- An order may have at most one *active* (queued or printing) KOT job at a
-- time. This is the final backstop against double-click, frontend retry,
-- duplicate Realtime events, or a repeated RPC call — independent of the
-- fact that confirm_bill_and_send_kot() can also only ever fire once per
-- order (it requires status = 'pending', which is a one-way transition).
-- printed/failed/cancelled jobs are historical and are not covered by this
-- index, so they don't block anything.
create unique index if not exists kot_print_jobs_one_active_per_order
  on public.kot_print_jobs (order_id)
  where status in ('queued', 'printing');

create index if not exists kot_print_jobs_restaurant_status_idx
  on public.kot_print_jobs (restaurant_id, status, queued_at);
create index if not exists kot_print_jobs_order_idx
  on public.kot_print_jobs (order_id);

-- ---------------------------------------------------------------------------
-- 2) RLS — restaurant-scoped read access only. No direct client
--    INSERT/UPDATE/DELETE: every mutation goes through a SECURITY DEFINER
--    RPC below (mirrors the orders_update_staff / "RPCs only" pattern from
--    0010_reception_billing_kot_workflow.sql, section 5).
-- ---------------------------------------------------------------------------
alter table public.kot_print_jobs enable row level security;

drop policy if exists kot_print_jobs_select on public.kot_print_jobs;
create policy kot_print_jobs_select on public.kot_print_jobs
  for select using (
    public.is_super_admin()
    or public.is_owner_or_admin_of(restaurant_id)
    or public.is_reception_of(restaurant_id)
    or public.is_kitchen_of(restaurant_id)
  );
  -- No policy grants guests (customer_uid-based access) or any other
  -- restaurant's staff anything here — RLS defaults to deny once enabled,
  -- and none of the helper checks above can ever be true for them.

drop policy if exists kot_print_jobs_insert_none on public.kot_print_jobs;
create policy kot_print_jobs_insert_none on public.kot_print_jobs
  for insert with check (public.is_super_admin());
  -- Ordinary creation happens only inside confirm_bill_and_send_kot() below,
  -- which is SECURITY DEFINER and bypasses this policy by design — exactly
  -- like create_order() bypasses the orders insert policy.

drop policy if exists kot_print_jobs_update_none on public.kot_print_jobs;
create policy kot_print_jobs_update_none on public.kot_print_jobs
  for update using (public.is_super_admin());
  -- Claiming / marking printed / marking failed happens only inside the
  -- claim_kot_print_job() / mark_kot_print_job_printed() /
  -- mark_kot_print_job_failed() RPCs below.

drop policy if exists kot_print_jobs_delete_none on public.kot_print_jobs;
create policy kot_print_jobs_delete_none on public.kot_print_jobs
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3) confirm_bill_and_send_kot — extended, in place, to also create the KOT
--    print job in the SAME transaction as the bill/KOT confirmation.
--
--    This is the exact function from 0011_reception_bill_reference.sql with
--    one addition: after the order row is updated, it builds a KOT snapshot
--    from the (already-persisted, unchanging) order_items and inserts one
--    `queued` kot_print_jobs row. `on conflict do nothing` against the
--    partial unique index above is defense in depth per section 15 — it
--    should never actually fire, since this branch only runs once (the
--    `status <> 'pending'` guard above already makes this RPC succeed at
--    most once per order), but it means a theoretical duplicate can never
--    surface as a hard error back to Reception.
--
--    Signature is unchanged (p_order_id uuid, p_bill_reference text default
--    null), so this is CREATE OR REPLACE, not drop+recreate — every existing
--    caller (Reception dashboard, Phase 1 Admin Orders page) is unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_bill_and_send_kot(p_order_id uuid, p_bill_reference text default null)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_restaurant    public.restaurants%rowtype;
  v_snapshot      jsonb;
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
         bill_reference = coalesce(nullif(btrim(p_bill_reference), ''), bill_reference),
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  -- Build the KOT snapshot from the restaurant + order + its (already
  -- persisted, immutable-post-creation) line items. Only what Kitchen/the
  -- Print Bridge needs to produce a ticket — no subtotal/total/price.
  select * into v_restaurant from public.restaurants where id = v_order.restaurant_id;

  select jsonb_build_object(
    'restaurantId', v_order.restaurant_id,
    'restaurantName', v_restaurant.name,
    'orderId', v_order.id,
    'tableNumber', v_order.table_number,
    'orderCreatedAt', v_order.created_at,
    'kotIssuedAt', v_order.kot_sent_at,
    'orderNotes', v_order.notes,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', oi.name,
            'category', oi.category,
            'quantity', oi.quantity,
            'notes', oi.notes
          )
          order by oi.created_at
        )
        from public.order_items oi
        where oi.order_id = v_order.id
      ),
      '[]'::jsonb
    )
  ) into v_snapshot;

  insert into public.kot_print_jobs (restaurant_id, order_id, status, kot_snapshot)
  values (v_order.restaurant_id, v_order.id, 'queued', v_snapshot)
  on conflict (order_id) where status in ('queued', 'printing') do nothing;

  return v_order;
end;
$$;

revoke all on function public.confirm_bill_and_send_kot(uuid, text) from public;
grant execute on function public.confirm_bill_and_send_kot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Future Print Bridge contract (sections 12-14). None of these functions
--    talk to a printer — they only move a job through the queue's own state
--    machine. Nothing calls these yet in Phase 3; they exist so the bridge
--    can be built later against a stable, already-secured contract.
--
--    Restricted to restaurant staff who could plausibly run/operate a
--    bridge for their own restaurant (kitchen, admin, owner) or a super
--    admin — never guests, never another restaurant's staff. Matches the
--    read-access rule in section 10.
-- ---------------------------------------------------------------------------

-- claim_kot_print_job — queued -> printing. Uses `for update skip locked` so
-- that if two workers race for the same job, only one ever claims it; the
-- other's lock attempt simply skips the row and this returns no row (not an
-- error) if the job is not there or already claimed by someone else.
create or replace function public.claim_kot_print_job(p_job_id uuid)
returns public.kot_print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.kot_print_jobs%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_job
    from public.kot_print_jobs
   where id = p_job_id
     and status = 'queued'
   for update skip locked;

  if not found then
    return null;
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_job.restaurant_id)
    or public.is_owner_or_admin_of(v_job.restaurant_id)
  ) then
    raise exception 'You may not claim KOT print jobs for another restaurant.'
      using errcode = '42501';
  end if;

  update public.kot_print_jobs
     set status = 'printing',
         claimed_at = now(),
         attempt_count = attempt_count + 1
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$$;

-- mark_kot_print_job_printed — printing -> printed. This is the ONLY way a
-- job may ever be marked printed; nothing in the Reception/Kitchen frontend
-- calls this in Phase 3 because no physical printer exists yet (see
-- sections 18-19).
create or replace function public.mark_kot_print_job_printed(p_job_id uuid)
returns public.kot_print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.kot_print_jobs%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_job from public.kot_print_jobs where id = p_job_id for update;
  if not found then
    raise exception 'KOT print job not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_job.restaurant_id)
    or public.is_owner_or_admin_of(v_job.restaurant_id)
  ) then
    raise exception 'You may not update KOT print jobs for another restaurant.'
      using errcode = '42501';
  end if;

  if v_job.status <> 'printing' then
    raise exception 'Job must be printing before it can be marked printed (current status: %).', v_job.status
      using errcode = '22023';
  end if;

  update public.kot_print_jobs
     set status = 'printed',
         printed_at = now()
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$$;

-- mark_kot_print_job_failed — printing -> failed. Terminal for Phase 3: no
-- automatic requeue/retry scheduling is implemented (section 14).
create or replace function public.mark_kot_print_job_failed(p_job_id uuid, p_error text default null)
returns public.kot_print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.kot_print_jobs%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_job from public.kot_print_jobs where id = p_job_id for update;
  if not found then
    raise exception 'KOT print job not found.' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.is_kitchen_of(v_job.restaurant_id)
    or public.is_owner_or_admin_of(v_job.restaurant_id)
  ) then
    raise exception 'You may not update KOT print jobs for another restaurant.'
      using errcode = '42501';
  end if;

  if v_job.status <> 'printing' then
    raise exception 'Job must be printing before it can be marked failed (current status: %).', v_job.status
      using errcode = '22023';
  end if;

  update public.kot_print_jobs
     set status = 'failed',
         failed_at = now(),
         last_error = nullif(btrim(coalesce(p_error, '')), '')
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_kot_print_job(uuid) from public;
revoke all on function public.mark_kot_print_job_printed(uuid) from public;
revoke all on function public.mark_kot_print_job_failed(uuid, text) from public;
grant execute on function public.claim_kot_print_job(uuid) to authenticated;
grant execute on function public.mark_kot_print_job_printed(uuid) to authenticated;
grant execute on function public.mark_kot_print_job_failed(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Realtime — same approach as 0009_enable_realtime_orders.sql. This lets
--    Reception's queue-status indicator update live, and gives a future
--    Print Bridge a way to listen for newly queued jobs instead of polling.
-- ---------------------------------------------------------------------------
alter table public.kot_print_jobs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kot_print_jobs'
  ) then
    alter publication supabase_realtime add table public.kot_print_jobs;
  end if;
end $$;
