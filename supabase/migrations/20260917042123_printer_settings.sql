create table if not exists public.printer_settings (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id)
    on delete cascade,

  name text not null default 'Kitchen Printer',

  connection_type text not null default 'lan'
    check (connection_type in ('lan', 'wifi', 'usb')),

  brand text not null,
  model text,

  ip_address text,
  port integer not null default 9100,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint printer_settings_connection_check
    check (
      (connection_type in ('lan', 'wifi') and ip_address is not null)
      or connection_type = 'usb'
    ),

  constraint printer_settings_port_check
    check (port between 1 and 65535)
);

create index if not exists printer_settings_restaurant_id_idx
  on public.printer_settings(restaurant_id);

create unique index if not exists printer_settings_one_active_per_restaurant_idx
  on public.printer_settings(restaurant_id)
  where is_active = true;

alter table public.printer_settings enable row level security;

drop policy if exists printer_settings_select on public.printer_settings;
create policy printer_settings_select
on public.printer_settings
for select
to authenticated
using (
  public.is_super_admin()
  or public.is_owner_or_admin_of(restaurant_id)
);

drop policy if exists printer_settings_insert on public.printer_settings;
create policy printer_settings_insert
on public.printer_settings
for insert
to authenticated
with check (
  public.is_super_admin()
  or public.is_owner_or_admin_of(restaurant_id)
);

drop policy if exists printer_settings_update on public.printer_settings;
create policy printer_settings_update
on public.printer_settings
for update
to authenticated
using (
  public.is_super_admin()
  or public.is_owner_or_admin_of(restaurant_id)
)
with check (
  public.is_super_admin()
  or public.is_owner_or_admin_of(restaurant_id)
);

drop policy if exists printer_settings_delete on public.printer_settings;
create policy printer_settings_delete
on public.printer_settings
for delete
to authenticated
using (
  public.is_super_admin()
  or public.is_owner_or_admin_of(restaurant_id)
);
