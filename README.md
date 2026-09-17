# QR Order — Multi-Tenant Restaurant Ordering SaaS

A production-oriented React (Vite) + Supabase application for restaurants to
take orders via table QR codes. Multi-tenant: one Supabase project serves many
restaurants, with strict tenant isolation enforced by PostgreSQL Row Level
Security and `SECURITY DEFINER` database functions — never by client-side
filtering alone.

> **Note on how this was built:** this codebase was migrated from an existing
> Firebase application to Supabase in-place — the UI, routes, and business
> logic were preserved; only the backend integration layer (auth, data
> access, storage, realtime, privileged functions) changed. The environment
> that generated this code has **no network access to Supabase**, so the SQL
> migrations, Edge Functions, and RLS policies below have not been applied
> against a live project or run through the security audit checklist in
> Section 7 — that is the next step, and you should treat it as required
> before going live, not optional.

## 1. Prerequisites

- Node.js 20+
- A Supabase project (this app is configured to use
  `https://kamojqdfylbntewndfpo.supabase.co` — update `.env` if different)
- Supabase CLI: `npm install -g supabase`

## 2. Install

```bash
npm install
```

## 3. Apply the database migrations

```bash
supabase link --project-ref kamojqdfylbntewndfpo
supabase db push
```

This runs, in order:
- `supabase/migrations/0001_schema.sql` — tables (idempotent: safe to run
  against a project that already has some or all of these tables; nothing is
  dropped or destroyed)
- `supabase/migrations/0002_rls.sql` — helper functions + Row Level Security
  policies on every table
- `supabase/migrations/0003_functions.sql` — `create_order()`,
  `create_restaurant()`, `assign_restaurant_owner()`
- `supabase/migrations/0004_storage.sql` — the `menu-images` bucket + storage
  policies
- `supabase/migrations/0005_restaurant_contact_update_rpc.sql` —
  `update_restaurant_contact_details()`, a `SECURITY DEFINER` RPC so the
  `create-restaurant` Edge Function can save address/phone/email without a
  direct table-level `UPDATE` grant on `restaurants`
- `supabase/migrations/0006_fix_table_status_check.sql` — re-creates
  `create_order()` to check `tables.status = 'active'` instead of the stale
  `'available'` value
- `supabase/migrations/0007_fix_tables_status_constraint.sql` — normalizes
  `tables.status` and its check constraint to the canonical `active`/
  `inactive` values (and updates the column default to match)
- `supabase/migrations/0008_restaurant_status_profile_rpc.sql` —
  `set_restaurant_status()` and `update_restaurant_profile()`, two
  `SECURITY DEFINER` RPCs so the frontend can change a restaurant's active
  status and profile fields without a direct table-level `UPDATE` grant on
  `restaurants`

If you'd rather apply them by hand, they're plain SQL — paste each file's
contents into the Supabase Dashboard's SQL Editor, in numeric order.

## 4. Deploy the Edge Functions

```bash
supabase functions deploy create-restaurant
supabase functions deploy invite-staff
supabase functions deploy update-staff-role
supabase functions deploy set-staff-status
supabase functions deploy remove-staff
```

Each function needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` available as **function secrets** (the Supabase
CLI sets `SUPABASE_URL`/`SUPABASE_ANON_KEY` automatically; you only need to
set the service-role key yourself):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your service role key>
```

**Never** put `SUPABASE_SERVICE_ROLE_KEY` in `.env`/`VITE_*` variables or any
frontend code — it only ever belongs here, as a function secret.

## 5. Enable Anonymous sign-ins

In Supabase Dashboard → Authentication → Providers → enable **Anonymous
Sign-ins**. This is what lets guests order via QR without creating an
account/password.

## 6. Configure the frontend

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://kamojqdfylbntewndfpo.supabase.co
VITE_SUPABASE_ANON_KEY=<your project's anon/public key>
```

Then run locally:

```bash
npm run dev
```

## 7. Create your first Super Admin

There is deliberately no client-facing way to become Super Admin — a normal
signup flow could never be trusted to self-assign that role (enforced at the
database level by a trigger, not just by UI hiding).

```bash
SUPABASE_URL=https://kamojqdfylbntewndfpo.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your service role key> \
node scripts/set-super-admin.mjs you@example.com
```

If the email doesn't have an account yet, the script invites one; if it does,
it's promoted directly. Sign in at `/login` — you'll land on `/super-admin`.

From there, **+ New restaurant** calls the `create-restaurant` Edge Function,
which invites (or links) the owner's account and assigns them via
`assign_restaurant_owner()`.

## 8. How roles/security work (read this before going live)

- Role and `restaurant_id` live **only** in the `profiles` table, read live
  by `SECURITY DEFINER` helper functions (`get_my_role()`,
  `get_my_restaurant_id()`, `is_super_admin()`, `is_staff_of()`,
  `is_owner_or_admin_of()`, `is_kitchen_of()`) — never trusted from a cached
  JWT claim, and never from anything the client sends.
- `profiles.role`/`profiles.restaurant_id` are immutable to everyone except a
  super admin (enforced by a `BEFORE UPDATE` trigger) — **a user can never
  assign themselves `super_admin`, or any other role.**
- Guests ordering via QR use **Supabase Anonymous Auth** — no password, no
  personal account. Their access is limited by RLS to public menu/table data
  and their own orders (`customer_uid = auth.uid()`); they cannot enumerate
  other orders or customers.
- `create_order()` is the **only** way an order can be created — direct
  client `INSERT`s on `orders`/`order_items` are always rejected by RLS. The
  function re-validates the restaurant, table, and every menu item, and
  recalculates prices/totals **from the current database rows**, so a
  customer can never manipulate totals from devtools.
- `SUPABASE_SERVICE_ROLE_KEY` is used only inside Edge Functions and the
  `scripts/set-super-admin.mjs` bootstrap script — never in the frontend
  bundle. Every Edge Function independently re-verifies the caller's role
  from a caller-scoped client (respecting RLS) before doing anything
  privileged with the service-role client.

## 9. Security audit checklist (run this before going live)

Since RLS/Edge Functions can only truly be verified against a live project,
walk through this after deploying (matches the checklist the product spec
required):

1. Super Admin can create a restaurant; owner receives an invite.
2. Signed in as Restaurant A's owner: confirm you cannot read/write
   Restaurant B's menu, tables, orders, customers, or staff — try forging a
   `restaurant_id` in a request from devtools and confirm it's rejected.
3. Signed in as kitchen staff: confirm the same isolation, plus that kitchen
   cannot access `customers`/`staff` data at all.
4. As a guest on Restaurant A's QR page: confirm you cannot query Restaurant
   B's menu/tables, cannot submit an order with a manipulated price (check
   the `create_order` RPC payload in devtools — the returned total should
   ignore any tampering), and cannot read another guest's order by ID.
5. Disable Restaurant A → confirm its QR page immediately stops accepting
   orders.
6. Disable a staff member → confirm their next request fails (their existing
   session should be invalidated by the Edge Function's `ban_duration` call).
7. Confirm storage: upload a menu image as Restaurant A's owner, then try
   (as Restaurant B's owner) to overwrite/delete that same file path —
   should be rejected.
8. Realtime: place an order as a guest, confirm it appears live on Kitchen,
   Admin Orders, and the guest's own Order Status page without a refresh.

## 10. Project structure

```
src/
  components/     shared UI (ErrorBoundary, Loading, EmptyState, ConfirmDialog…)
  context/        AuthContext, CartContext, ToastContext
  supabase/       Supabase client init
  layouts/        AdminLayout, SuperAdminLayout, KitchenLayout
  pages/
    admin/        restaurant owner/admin dashboard pages
    superadmin/    platform-level pages
    kitchen/       kitchen order queue
    customer/      public QR-driven ordering flow (/r/:slug/table/:number)
  routes/         ProtectedRoute, AppRoutes (all route definitions, lazy-loaded)
  services/       Supabase data/storage/RPC/Edge Function access, kept out of components
  styles/         index.css
  utils/          formatters
supabase/
  migrations/     schema, RLS policies, RPC functions, storage policies (SQL)
  functions/      Edge Functions (create-restaurant, invite-staff, etc.)
scripts/          set-super-admin.mjs — one-time bootstrap (local/CI use only)
print-bridge/     Local Print Bridge — independent Node process, see print-bridge/README.md
```

## 11. Known non-critical limitations

- Double-order-submission protection is client-side only (the place-order
  button disables itself while submitting) — there's no server-side
  idempotency key. Low risk given the button-disable UX, but worth adding if
  you see duplicate orders in practice.
- `listenOrdersForAdmin`'s status/table filters are applied client-side after
  a broader realtime subscription (Postgres realtime filters are static per
  channel), which is fine at this scale but worth revisiting if a single
  restaurant's order volume gets very large.
- The Edge Functions and RLS policies have not been exercised against a live
  Supabase project from this environment — run the Section 9 checklist
  yourself before relying on them in production.

## 12. Extending this later

The data model and security rules were written to comfortably support
(without a rewrite): online payments, WhatsApp notifications, receipt
printers, POS integration, inventory, multi-branch restaurants, granular
staff permissions, discounts, loyalty, reviews, reservations,
takeaway/delivery, subscriptions, and deeper analytics.

Receipt/KOT printing has a foundation already in place: `kot_print_jobs`
(migration `0012_kot_print_queue.sql`) plus the `print-bridge/` local
bridge process. See `print-bridge/README.md` and
`print-bridge/PHYSICAL_PRINTER.md` for what's implemented and what's still
needed (a real printer adapter for a specific make/model/connection).
