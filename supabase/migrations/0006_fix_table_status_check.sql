-- ============================================================================
-- 0006_fix_table_status_check.sql
--
-- Schema drift fix: public.tables.status is constrained in the live database
-- by `tables_status_check` to ('active', 'inactive'). The original
-- create_order() RPC (0003_functions.sql) still checked for the stale value
-- 'available', which meant every table would be reported as "not currently
-- available" and NO order could ever be placed.
--
-- This migration re-creates create_order() with the corrected status check.
-- 0003_functions.sql is left untouched (it has already been applied) — this
-- file is what actually updates the live function via CREATE OR REPLACE.
--
-- No RLS policies, grants, or the tables_status_check constraint itself are
-- changed. Inactive tables remain blocked from ordering.
-- ============================================================================

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_table_id      uuid,
  p_items         jsonb,          -- [{ "menu_item_id": "...", "quantity": 2, "notes": "..." }, ...]
  p_customer_name  text default null,
  p_customer_phone text default null,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_restaurant     public.restaurants%rowtype;
  v_table          public.tables%rowtype;
  v_item           jsonb;
  v_menu_item      public.menu_items%rowtype;
  v_quantity       integer;
  v_line_subtotal  numeric(10,2);
  v_subtotal       numeric(10,2) := 0;
  v_item_count     integer := 0;
  v_order_id       uuid;
  v_customer_id    uuid;
  v_line_items     jsonb := '[]'::jsonb;
begin
  -- 1) Caller must be authenticated (anonymous guest session is the normal
  --    path; a signed-in staff/super_admin account is technically allowed
  --    too, but never an unauthenticated request).
  if v_uid is null then
    raise exception 'Authentication required to place an order.' using errcode = '28000';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many distinct items in a single order.' using errcode = '22023';
  end if;

  -- 2) Restaurant must exist and be active.
  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'Restaurant not found.' using errcode = '22023';
  end if;
  if not v_restaurant.is_active then
    raise exception 'This restaurant is not currently accepting orders.' using errcode = '22023';
  end if;

  -- 3) Table must exist, belong to this restaurant, and be active.
  --    (tables_status_check only allows 'active' / 'inactive' — updated here
  --    from the stale 'available' check that never matched a real row.)
  select * into v_table from public.tables where id = p_table_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'Table not found for this restaurant.' using errcode = '22023';
  end if;
  if v_table.status <> 'active' then
    raise exception 'This table is not currently available.' using errcode = '22023';
  end if;

  -- 4) Validate every item belongs to the restaurant, is available, and
  --    compute the REAL price/subtotal from the database — never from the
  --    client payload.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid quantity for an item.' using errcode = '22023';
    end if;

    select * into v_menu_item
      from public.menu_items
      where id = (v_item ->> 'menu_item_id')::uuid
        and restaurant_id = p_restaurant_id;

    if not found then
      raise exception 'One or more menu items do not belong to this restaurant.' using errcode = '22023';
    end if;
    if v_menu_item.available = false or v_menu_item.sold_out = true then
      raise exception '% is not available right now.', v_menu_item.name using errcode = '22023';
    end if;

    v_line_subtotal := round(v_menu_item.price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_subtotal;
    v_item_count := v_item_count + v_quantity;

    v_line_items := v_line_items || jsonb_build_object(
      'menu_item_id', v_menu_item.id,
      'name', v_menu_item.name,
      'category', v_menu_item.category,
      'price', v_menu_item.price,
      'quantity', v_quantity,
      'subtotal', v_line_subtotal,
      'notes', nullif(btrim(coalesce(v_item ->> 'notes', '')), '')
    );
  end loop;

  if v_item_count > 200 then
    raise exception 'Order quantity too large.' using errcode = '22023';
  end if;

  -- 5) No separate tax/service charge in this schema — total mirrors subtotal.
  --    (Kept as a distinct column so restaurant-level fees can be introduced
  --    later without a breaking schema change.)

  -- 6) Upsert the customer record for this restaurant+auth session.
  insert into public.customers (restaurant_id, auth_user_id, name, phone, order_count, total_spent, last_order_at)
  values (p_restaurant_id, v_uid, nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_customer_phone, '')), ''), 1, v_subtotal, now())
  on conflict (restaurant_id, auth_user_id) where auth_user_id is not null
  do update set
    name = coalesce(nullif(btrim(coalesce(excluded.name, '')), ''), public.customers.name),
    phone = coalesce(nullif(btrim(coalesce(excluded.phone, '')), ''), public.customers.phone),
    order_count = public.customers.order_count + 1,
    total_spent = public.customers.total_spent + v_subtotal,
    last_order_at = now()
  returning id into v_customer_id;

  -- 7) Create the order (status always starts at 'pending').
  insert into public.orders (
    restaurant_id, table_id, customer_id, customer_uid, table_number,
    customer_name, customer_phone, notes, subtotal, total, status
  ) values (
    p_restaurant_id, p_table_id, v_customer_id, v_uid, v_table.table_number,
    nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_customer_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), v_subtotal, v_subtotal, 'pending'
  ) returning id into v_order_id;

  -- 8) Persist order_items from the validated/priced line items.
  insert into public.order_items (order_id, menu_item_id, name, category, price, quantity, subtotal, notes)
  select
    v_order_id,
    (li ->> 'menu_item_id')::uuid,
    li ->> 'name',
    li ->> 'category',
    (li ->> 'price')::numeric,
    (li ->> 'quantity')::integer,
    (li ->> 'subtotal')::numeric,
    li ->> 'notes'
  from jsonb_array_elements(v_line_items) as li;

  -- 9) Return the created order with its items.
  return jsonb_build_object(
    'orderId', v_order_id,
    'restaurantId', p_restaurant_id,
    'tableId', p_table_id,
    'tableNumber', v_table.table_number,
    'subtotal', v_subtotal,
    'total', v_subtotal,
    'status', 'pending',
    'items', v_line_items
  );
end;
$$;

-- CREATE OR REPLACE preserves existing ownership/grants, but these are
-- re-issued explicitly so the migration is self-contained and idempotent.
revoke all on function public.create_order(uuid, uuid, jsonb, text, text, text) from public;
grant execute on function public.create_order(uuid, uuid, jsonb, text, text, text) to authenticated, anon;
