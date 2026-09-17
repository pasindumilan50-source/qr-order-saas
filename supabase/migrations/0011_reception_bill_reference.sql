-- ============================================================================
-- 0011_reception_bill_reference.sql
--
-- Phase 2 — Reception/Cashier Dashboard: manual bill reference field.
--
-- WHY THIS MIGRATION EXISTS
-- --------------------------
-- Phase 1 (0010_reception_billing_kot_workflow.sql) recorded WHO confirmed
-- the bill and WHEN (bill_confirmed_at / bill_confirmed_by), but did not add
-- anywhere to record the restaurant's OWN manual bill/receipt number. The
-- Phase 2 brief requires a "Bill Number / Reference" field in the Reception
-- UI "if the existing schema supports storing this" — it was inspected and
-- does not, so this migration adds exactly one new nullable column rather
-- than skipping the requirement or inventing a parallel financial record.
--
-- This is NOT a financial/accounting field: it is a free-text reference the
-- Cashier may optionally note. It does not duplicate, replace, or affect
-- `subtotal`/`total`, and no new totals are computed anywhere.
--
-- Rather than adding a second RPC or a direct-table-write path (both of
-- which would be inconsistent with 0010's "no direct client UPDATEs to
-- orders" rule), the existing `confirm_bill_and_send_kot` RPC is extended
-- with a single optional parameter (default null). The one Reception action
-- — confirm bill + issue KOT — still happens atomically in one call.
-- Existing callers that invoke it as `confirm_bill_and_send_kot(order_id)`
-- only (e.g. the Phase 1 Admin Orders page) are unaffected: the parameter
-- defaults to null and the row's existing bill_reference (if any) is left
-- untouched.
-- ============================================================================

alter table public.orders add column if not exists bill_reference text;

-- The original (uuid)-only signature must be dropped before recreating with
-- an added parameter — CREATE OR REPLACE cannot change a function's
-- parameter list in place, and leaving the old signature in place alongside
-- the new one would make single-argument calls ambiguous.
drop function if exists public.confirm_bill_and_send_kot(uuid);

create or replace function public.confirm_bill_and_send_kot(p_order_id uuid, p_bill_reference text default null)
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
         bill_reference = coalesce(nullif(btrim(p_bill_reference), ''), bill_reference),
         updated_at = now()
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.confirm_bill_and_send_kot(uuid, text) from public;
grant execute on function public.confirm_bill_and_send_kot(uuid, text) to authenticated;
