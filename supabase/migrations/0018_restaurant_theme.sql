-- 0018_restaurant_theme.sql
-- Per-restaurant Customer UI theme. Stored on the existing `restaurants` row
-- (same place as logo + hero settings), so it is automatically scoped to one
-- tenant and is readable by the anonymous QR page through the existing
-- public-select policy. NULL = "no custom theme" -> the current default look.

alter table public.restaurants
  add column if not exists theme_bg     text check (theme_bg     is null or theme_bg     ~* '^#[0-9a-f]{6}$'),
  add column if not exists theme_accent text check (theme_accent is null or theme_accent ~* '^#[0-9a-f]{6}$'),
  add column if not exists theme_preset text check (theme_preset is null or char_length(theme_preset) <= 40);

-- Same access model as the other restaurant RPCs: SECURITY DEFINER, with
-- authorization enforced inside (owner/admin of THAT restaurant, or super admin).
create or replace function public.update_restaurant_theme(
  p_restaurant_id uuid,
  p_theme_bg      text default null,
  p_theme_accent  text default null,
  p_theme_preset  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin() or public.is_owner_or_admin_of(p_restaurant_id)) then
    raise exception 'Not allowed to change this restaurant''s theme.' using errcode = '42501';
  end if;

  if p_theme_bg is not null and p_theme_bg !~* '^#[0-9a-f]{6}$' then
    raise exception 'Invalid background color.' using errcode = '22023';
  end if;
  if p_theme_accent is not null and p_theme_accent !~* '^#[0-9a-f]{6}$' then
    raise exception 'Invalid accent color.' using errcode = '22023';
  end if;

  -- All-NULL input clears the theme (back to the default look).
  update public.restaurants
     set theme_bg     = lower(p_theme_bg),
         theme_accent = lower(p_theme_accent),
         theme_preset = p_theme_preset
   where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_restaurant_theme(uuid, text, text, text) from public;
grant execute on function public.update_restaurant_theme(uuid, text, text, text) to authenticated;
