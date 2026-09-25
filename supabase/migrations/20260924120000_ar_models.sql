-- 20260924120000_ar_models.sql
-- Optional 3D / AR models for menu items.
-- * Two nullable columns on menu_items (existing rows untouched).
-- * Dedicated public-read bucket `ar-models`, write access limited to the
--   restaurant's own owner/admin (or super admin), same model as `menu-images`.
-- Path convention: ar-models/{restaurant_id}/{menu_item_id}/model.glb|model.usdz
-- Safe to re-run.

alter table public.menu_items
  add column if not exists model_glb_url  text,
  add column if not exists model_usdz_url text;

-- Tenant isolation at the DB level: a URL saved on a menu item must point at
-- THAT item's own folder ({restaurant_id}/{id}/model.ext). An admin therefore
-- cannot make their item reference another restaurant's model file.
alter table public.menu_items drop constraint if exists menu_items_model_glb_url_scope;
alter table public.menu_items add constraint menu_items_model_glb_url_scope check (
  model_glb_url is null
  or model_glb_url like '%/ar-models/' || restaurant_id::text || '/' || id::text || '/model.glb%'
);
alter table public.menu_items drop constraint if exists menu_items_model_usdz_url_scope;
alter table public.menu_items add constraint menu_items_model_usdz_url_scope check (
  model_usdz_url is null
  or model_usdz_url like '%/ar-models/' || restaurant_id::text || '/' || id::text || '/model.usdz%'
);

-- Bucket: public READ only (customers on the anonymous QR page need it),
-- 15 MB hard cap enforced by Storage itself.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ar-models', 'ar-models', true, 15728640)
on conflict (id) do update set public = true, file_size_limit = 15728640;

-- storage_owns_restaurant() is defined in 0004_storage.sql: first path segment
-- must be a restaurant the caller owns/admins (or super admin).
drop policy if exists ar_models_public_read on storage.objects;
create policy ar_models_public_read on storage.objects
  for select using (bucket_id = 'ar-models');

drop policy if exists ar_models_staff_insert on storage.objects;
create policy ar_models_staff_insert on storage.objects
  for insert with check (bucket_id = 'ar-models' and public.storage_owns_restaurant(name));

drop policy if exists ar_models_staff_update on storage.objects;
create policy ar_models_staff_update on storage.objects
  for update using (bucket_id = 'ar-models' and public.storage_owns_restaurant(name))
  with check (bucket_id = 'ar-models' and public.storage_owns_restaurant(name));

drop policy if exists ar_models_staff_delete on storage.objects;
create policy ar_models_staff_delete on storage.objects
  for delete using (bucket_id = 'ar-models' and public.storage_owns_restaurant(name));
