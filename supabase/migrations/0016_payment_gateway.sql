-- ============================================================================
-- 0016_payment_gateway.sql
--
-- PayHere card payment support, additive on top of 0010's bill/KOT workflow.
--
-- Business rule (per project decision):
--   ... -> ready (food prepared, bill generated)
--     -> customer pays from their own device (self-checkout)
--          - Cash: unchanged. Reception/Kitchen/admin still call
--            complete_order() exactly as before.
--          - Card: customer triggers PayHere Checkout. The frontend NEVER
--            marks a payment paid. Only the verified PayHere server
--            notification (via the payhere-notify Edge Function, using the
--            service_role key) is trusted to flip payment_status to 'paid'
--            and complete the order in the same transaction.
--     -> completed -> table becomes available again (existing logic)
--
-- This migration does not touch orders.status values, does not remove any
-- existing column, and does not change complete_order()/cancel_order()/etc.
-- from 0010. It is additive and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Payment columns on orders.
--    payment_status defaults to NULL (not every order is paid by card — cash
--    orders never touch these columns unless you choose to backfill them).
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists payment_method   text;
alter table public.orders add column if not exists payment_status  text;
alter table public.orders add column if not exists payment_id      text;
alter table public.orders add column if not exists payment_provider text;
alter table public.orders add column if not exists paid_at         timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_method_check'
  ) then
    alter table public.orders add constraint orders_payment_method_check
      check (payment_method is null or payment_method in ('cash', 'card'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_status_check'
  ) then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status is null or payment_status in ('pending', 'paid', 'failed', 'cancelled'));
  end if;

  -- "when" and "how" always travel together.
  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_paid_consistency'
  ) then
    alter table public.orders add constraint orders_payment_paid_consistency
      check (
        (payment_status <> 'paid') or (paid_at is not null and payment_id is not null)
      );
  end if;
end $$;

create index if not exists orders_payment_status_idx
  on public.orders (restaurant_id, payment_status);

-- ---------------------------------------------------------------------------
-- 2) payment_transactions — one row per PayHere notification we accept.
--    This is the idempotency guard: PayHere may resend the same notification
--    more than once. A unique constraint on (provider, payment_id) means a
--    duplicate insert fails harmlessly and the Edge Function treats that as
--    "already processed, do nothing".
-- ---------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  provider          text not null default 'payhere',
  payment_id        text not null,
  status_code       text not null,
  amount            numeric(10,2) not null,
  currency          text not null,
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  unique (provider, payment_id)
);

create index if not exists payment_transactions_order_idx
  on public.payment_transactions (order_id);

alter table public.payment_transactions enable row level security;

-- Staff of the order's restaurant (or super admin) may read transactions for
-- audit purposes. Nobody outside the service role may write directly — all
-- writes happen via the SECURITY DEFINER function below.
drop policy if exists payment_transactions_select on public.payment_transactions;
create policy payment_transactions_select on public.payment_transactions
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = payment_transactions.order_id
        and (
          public.is_super_admin()
          or public.is_owner_or_admin_of(o.restaurant_id)
          or public.is_reception_of(o.restaurant_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3) mark_order_payment_pending — called by the CUSTOMER right before they
--    are redirected to PayHere Checkout. This only ever sets 'pending', so
--    even if a malicious client called it directly, the worst it can do is
--    flag its own order as "payment pending" — it can never mark paid.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_payment_pending(
  p_order_id uuid,
  p_payment_method text
)
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

  if p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if v_order.customer_uid is distinct from v_uid then
    raise exception 'You may not act on this order.' using errcode = '42501';
  end if;

  if v_order.status <> 'ready' then
    raise exception 'This order is not ready for payment yet (current status: %).', v_order.status
      using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    raise exception 'This order has already been paid.' using errcode = '22023';
  end if;

  update public.orders
     set payment_method = p_payment_method,
         payment_status = 'pending',
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.mark_order_payment_pending(uuid, text) from public;
grant execute on function public.mark_order_payment_pending(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) confirm_card_payment_and_complete — the ONLY path that can ever mark a
--    payment 'paid'. Not granted to `authenticated` or `anon` at all — only
--    the Supabase service_role (used exclusively by the payhere-notify Edge
--    Function, never by the browser) may call this. Idempotent: the caller
--    must insert into payment_transactions first; if that insert is skipped
--    (duplicate), this function must not be called a second time for the
--    same payment_id.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_card_payment_and_complete(
  p_order_id uuid,
  p_payment_id text,
  p_provider text default 'payhere'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    -- Already processed (should not normally happen once the caller checks
    -- payment_transactions first, but stay safe/idempotent regardless).
    return v_order;
  end if;

  update public.orders
     set payment_status = 'paid',
         payment_id = p_payment_id,
         payment_provider = p_provider,
         paid_at = now(),
         status = case when status = 'ready' then 'completed' else status end,
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.confirm_card_payment_and_complete(uuid, text, text) from public;
grant execute on function public.confirm_card_payment_and_complete(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) mark_card_payment_failed — also service_role-only, used by the Edge
--    Function when PayHere reports a failed/cancelled status_code.
-- ---------------------------------------------------------------------------
create or replace function public.mark_card_payment_failed(
  p_order_id uuid,
  p_status text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    -- Never downgrade a paid order.
    return v_order;
  end if;

  update public.orders
     set payment_status = p_status,
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.mark_card_payment_failed(uuid, text) from public;
grant execute on function public.mark_card_payment_failed(uuid, text) to service_role;
