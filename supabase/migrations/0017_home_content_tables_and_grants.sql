-- 0017_home_content_tables_and_grants.sql
-- Fixes: "permission denied for table restaurant_promotions" (HTTP 403)
-- Cause: these tables have no migration in the repo; when created by hand they
-- get no GRANTs for the anon/authenticated roles. RLS alone isn't enough.
-- Safe to re-run.

create table if not exists public.restaurant_hero_slides (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  image_url     text not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.restaurant_promotions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  image_url     text,
  promo_text    text not null,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists restaurant_hero_slides_rest_idx on public.restaurant_hero_slides (restaurant_id, sort_order);
create index if not exists restaurant_promotions_rest_idx  on public.restaurant_promotions  (restaurant_id, sort_order);

alter table public.restaurant_hero_slides enable row level security;
alter table public.restaurant_promotions  enable row level security;

-- Table privileges (this is what the 403 is complaining about)
grant select on public.restaurant_hero_slides, public.restaurant_promotions to anon, authenticated;
grant insert, update, delete on public.restaurant_hero_slides, public.restaurant_promotions to authenticated;
grant all on public.restaurant_hero_slides, public.restaurant_promotions to service_role;

-- Policies: public read (customer home page), owner/admin write
do $$
declare t text;
begin
  foreach t in array array['restaurant_hero_slides','restaurant_promotions'] loop
    execute format('drop policy if exists %1$s_select_public on public.%1$s', t);
    execute format('create policy %1$s_select_public on public.%1$s for select using (true)', t);

    execute format('drop policy if exists %1$s_insert_staff on public.%1$s', t);
    execute format('create policy %1$s_insert_staff on public.%1$s for insert with check (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id))', t);

    execute format('drop policy if exists %1$s_update_staff on public.%1$s', t);
    execute format('create policy %1$s_update_staff on public.%1$s for update using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id))', t);

    execute format('drop policy if exists %1$s_delete_staff on public.%1$s', t);
    execute format('create policy %1$s_delete_staff on public.%1$s for delete using (public.is_super_admin() or public.is_owner_or_admin_of(restaurant_id))', t);
  end loop;
end $$;

-- Realtime (the service subscribes to postgres_changes)
do $$
begin
  begin alter publication supabase_realtime add table public.restaurant_hero_slides; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.restaurant_promotions;  exception when duplicate_object then null; end;
end $$;
