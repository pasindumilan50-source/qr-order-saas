-- ============================================================================
-- 0009_enable_realtime_orders.sql
--
-- The frontend (src/services/orderService.js) already subscribes to
-- `postgres_changes` on `public.orders` for the kitchen view, the admin
-- orders view, and the customer order-status page. None of that ever fires,
-- because no previous migration added `orders` / `order_items` to the
-- `supabase_realtime` publication — Postgres was never told to broadcast
-- changes on these tables. Without this, the app only ever shows fresh data
-- after a manual page refresh (which just re-runs the initial fetch).
--
-- This migration:
--   1. Adds `orders` and `order_items` to the `supabase_realtime` publication
--      so INSERT/UPDATE/DELETE events are actually broadcast.
--   2. Sets REPLICA IDENTITY FULL on both tables. This isn't needed for the
--      restaurant_id filter to match on INSERT (new rows always carry full
--      data), but it is needed for UPDATE events to reliably include full
--      column data in the "old record" payload (e.g. so a status change
--      pending -> confirmed -> preparing -> ready is never missed because of
--      a partial replica-identity row), and for order_items DELETE events.
-- ============================================================================

alter table public.orders replica identity full;
alter table public.order_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end $$;
