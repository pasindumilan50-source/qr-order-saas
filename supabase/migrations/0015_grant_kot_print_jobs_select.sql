-- Print Bridge needs to read queued KOT jobs.
-- RLS still restricts rows to the authenticated user's restaurant.

grant select on table public.kot_print_jobs to authenticated;
