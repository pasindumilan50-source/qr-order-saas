-- ============================================================================
-- 0004_storage.sql
-- Storage bucket + policies for menu/logo images.
-- Path convention: menu-images/{restaurant_id}/{filename}
-- Public read (menu images need to be visible on the anonymous QR menu);
-- write access restricted to that restaurant's owner/admin (or super admin).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- Helper: first path segment is the restaurant_id.
create or replace function public.storage_owns_restaurant(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_super_admin()
     or public.is_owner_or_admin_of((storage.foldername(object_name))[1]::uuid);
$$;

revoke all on function public.storage_owns_restaurant(text) from public;
grant execute on function public.storage_owns_restaurant(text) to authenticated, anon;

drop policy if exists menu_images_public_read on storage.objects;
create policy menu_images_public_read on storage.objects
  for select using (bucket_id = 'menu-images');

drop policy if exists menu_images_staff_insert on storage.objects;
create policy menu_images_staff_insert on storage.objects
  for insert with check (bucket_id = 'menu-images' and public.storage_owns_restaurant(name));

drop policy if exists menu_images_staff_update on storage.objects;
create policy menu_images_staff_update on storage.objects
  for update using (bucket_id = 'menu-images' and public.storage_owns_restaurant(name));

drop policy if exists menu_images_staff_delete on storage.objects;
create policy menu_images_staff_delete on storage.objects
  for delete using (bucket_id = 'menu-images' and public.storage_owns_restaurant(name));
