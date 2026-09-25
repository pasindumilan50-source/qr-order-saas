-- Raise the ar-models bucket cap so a 25 MB GLB (client-side limit) can
-- actually upload; the bucket's own hard limit was 15 MB before this.
update storage.buckets
set file_size_limit = 26214400  -- 25 MB
where id = 'ar-models';
