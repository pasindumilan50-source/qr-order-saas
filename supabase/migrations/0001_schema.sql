-- ============================================================================
-- 0001_schema.sql
-- Restaurant QR Ordering SaaS — Supabase schema
--
-- SAFE / IDEMPOTENT: uses IF NOT EXISTS everywhere so this can be run against
-- a database that already has some or all of these tables (per project
-- instructions: do not drop or destroy existing tables/data). Extra columns
-- needed to preserve existing application features (logo, sold-out flag,
-- QR slug, etc.) are added additively with ADD COLUMN IF NOT EXISTS.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text,
  owner_id    uuid references auth.users(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.restaurants add column if not exists slug text;
alter table public.restaurants add column if not exists logo_url text;
alter table public.restaurants add column if not exists address text;
alter table public.restaurants add column if not exists phone text;
alter table public.restaurants add column if not exists email text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_name_not_blank'
  ) then
    alter table public.restaurants
      add constraint restaurants_name_not_blank check (btrim(name) <> '');
  end if;
end $$;

create unique index if not exists restaurants_slug_key on public.restaurants (slug) where slug is not null;
create index if not exists restaurants_owner_id_idx on public.restaurants (owner_id);
create index if not exists restaurants_is_active_idx on public.restaurants (is_active);

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users — authoritative role + tenant assignment)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  restaurant_id  uuid references public.restaurants(id) on delete set null,
  role           text,
  full_name      text,
  email          text,
  phone          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check
      check (role is null or role in ('super_admin', 'owner', 'admin', 'kitchen'));
  end if;
end $$;

create index if not exists profiles_restaurant_id_idx on public.profiles (restaurant_id);
create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  name           text not null,
  description    text,
  price          numeric(10,2) not null,
  image_url      text,
  category       text not null default 'Uncategorized',
  available      boolean not null default true,
  sold_out       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.menu_items add column if not exists sold_out boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_price_nonneg') then
    alter table public.menu_items add constraint menu_items_price_nonneg check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_name_not_blank') then
    alter table public.menu_items add constraint menu_items_name_not_blank check (btrim(name) <> '');
  end if;
end $$;

create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id, category, name);

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists public.tables (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  table_number   text not null,
  status         text not null default 'available',
  qr_url         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tables_status_check') then
    alter table public.tables add constraint tables_status_check check (status in ('available', 'disabled'));
  end if;
end $$;

create unique index if not exists tables_restaurant_number_key on public.tables (restaurant_id, table_number);
create index if not exists tables_restaurant_idx on public.tables (restaurant_id);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id   uuid references auth.users(id) on delete set null,
  name           text,
  phone          text,
  email          text,
  order_count    integer not null default 0,
  total_spent    numeric(10,2) not null default 0,
  created_at     timestamptz not null default now(),
  last_order_at  timestamptz
);

alter table public.customers add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists customers_restaurant_auth_user_key
  on public.customers (restaurant_id, auth_user_id) where auth_user_id is not null;
create index if not exists customers_restaurant_idx on public.customers (restaurant_id, last_order_at desc);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  table_id        uuid not null references public.tables(id),
  customer_id     uuid references public.customers(id),
  customer_uid    uuid references auth.users(id),
  table_number    text not null,
  customer_name   text,
  customer_phone  text,
  notes           text,
  subtotal        numeric(10,2) not null,
  total           numeric(10,2) not null,
  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.orders add column if not exists customer_uid uuid references auth.users(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_status_check') then
    alter table public.orders add constraint orders_status_check
      check (status in ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_totals_nonneg') then
    alter table public.orders add constraint orders_totals_nonneg check (subtotal >= 0 and total >= 0);
  end if;
end $$;

create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create index if not exists orders_restaurant_status_idx on public.orders (restaurant_id, status, created_at desc);
create index if not exists orders_restaurant_table_idx on public.orders (restaurant_id, table_id, created_at desc);
create index if not exists orders_customer_uid_idx on public.orders (customer_uid);

-- ---------------------------------------------------------------------------
-- order_items  (normalized line items — preserves historical price/name)
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  name          text not null,
  category      text not null default 'Uncategorized',
  price         numeric(10,2) not null,
  quantity      integer not null,
  subtotal      numeric(10,2) not null,
  notes         text,
  created_at    timestamptz not null default now()
);

alter table public.order_items add column if not exists category text not null default 'Uncategorized';
alter table public.order_items add column if not exists notes text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_qty_check') then
    alter table public.order_items add constraint order_items_qty_check check (quantity > 0 and quantity <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_price_nonneg') then
    alter table public.order_items add constraint order_items_price_nonneg check (price >= 0 and subtotal >= 0);
  end if;
end $$;

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- staff  (restaurant-scoped staff membership; role also mirrored on profiles)
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text,
  email          text,
  role           text not null,
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_role_check') then
    alter table public.staff add constraint staff_role_check check (role in ('owner', 'admin', 'kitchen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_status_check') then
    alter table public.staff add constraint staff_status_check check (status in ('active', 'disabled'));
  end if;
end $$;

create unique index if not exists staff_restaurant_user_key on public.staff (restaurant_id, user_id);
create index if not exists staff_restaurant_idx on public.staff (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- staff_invitations (bootstrap for invite-staff Edge Function; tracks state)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_invitations (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  email          text not null,
  name           text,
  role           text not null,
  invited_by     uuid references auth.users(id),
  status         text not null default 'pending',
  created_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_invitations_role_check') then
    alter table public.staff_invitations add constraint staff_invitations_role_check check (role in ('admin', 'kitchen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_invitations_status_check') then
    alter table public.staff_invitations add constraint staff_invitations_status_check check (status in ('pending', 'accepted', 'revoked'));
  end if;
end $$;

create index if not exists staff_invitations_restaurant_idx on public.staff_invitations (restaurant_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper (generic, reused by several tables)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['restaurants','profiles','menu_items','tables','orders','staff']
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_set_updated_at'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at();',
        t || '_set_updated_at', t
      );
    end if;
  end loop;
end $$;
