-- ============================================================================
-- 0007_fix_tables_status_constraint.sql
--
-- public.tables.status must be constrained to exactly ('active', 'inactive').
-- 0001_schema.sql originally created tables_status_check as
-- check (status in ('available', 'disabled')), and the live database's
-- current constraint definition has since drifted from that (and possibly
-- from any other migration file in this repo). Rather than assume which
-- state it's in, this migration is written to be safe regardless: it
-- normalizes any legacy row values, then unconditionally drops and
-- re-creates the constraint with the exact definition the app requires.
--
-- Only public.tables.status / tables_status_check is touched. No other
-- table, constraint, RLS policy, or grant is modified.
-- ============================================================================

-- 1) Drop the existing constraint FIRST. Its current definition (whatever
--    it currently allows on live) would otherwise reject the UPDATEs below
--    while normalizing legacy values — the constraint must not be in the
--    way while we fix the data it constrains.
alter table public.tables drop constraint if exists tables_status_check;

-- 2) Migrate any legacy status values so no existing row can violate the
--    new constraint. These UPDATEs are no-ops (0 rows) if no legacy values
--    are present.
update public.tables set status = 'active'   where status = 'available';
update public.tables set status = 'inactive' where status = 'disabled';

-- 3) Re-add the constraint with the exact allowed set: 'active' / 'inactive'.
alter table public.tables
  add constraint tables_status_check check (status in ('active', 'inactive'));

-- 4) Align the column default with the new constraint so any future insert
--    that omits status (bypassing the app's explicit status: 'active')
--    still satisfies the constraint instead of reintroducing this bug.
alter table public.tables alter column status set default 'active';
