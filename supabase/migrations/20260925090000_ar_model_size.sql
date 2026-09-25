-- 20260925090000_ar_model_size.sql
-- Lets an admin set each menu item's real-world AR size from the dashboard,
-- instead of one fixed size for every dish in code.
-- NULL = use the app's default size (currently 15cm).

alter table public.menu_items
  add column if not exists model_size_cm numeric;

alter table public.menu_items drop constraint if exists menu_items_model_size_cm_range;
alter table public.menu_items add constraint menu_items_model_size_cm_range
  check (model_size_cm is null or (model_size_cm > 0 and model_size_cm <= 100));
