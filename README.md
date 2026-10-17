# Hotel Amrut guest ordering prototype

A mobile first guest ordering prototype for Hotel Amrut in Karwar. The existing Next.js guest UI and illustrative menu remain the active prototype; the repository also contains a Supabase local-development foundation. No hosted Supabase project is linked.

## Run the prototype

```bash
npm install
npm run dev
```

The `/join` route uses the Supabase browser client, anonymous Auth, and the `join_table_session` RPC. It stores returned membership details in browser storage, but does not yet revalidate membership or session status after a refresh. The homepage menu and prices in `src/data/menu.ts` are illustrative placeholders, and its cart state is local to the browser rather than shared across devices. Checkout, split calculations, and order tracking are demonstrations. The frontend does not yet call `add_to_cart`; order submission, payment processing, and Realtime synchronization are not implemented.

## Supabase local development

Requirements: Docker Desktop or another Docker-compatible runtime, Node.js 20+, and npm. The Supabase CLI is pinned as an exact development dependency (`supabase@2.120.0`) in `package.json` and `package-lock.json`.

```bash
npm install
cp .env.example .env.local
# Add local Supabase URL and publishable key values to the ignored .env.local for /join.
npm run db:start
npm run db:status
npm run db:reset
npm run db:test
npm run db:test:join
```

`db:reset` reapplies local migrations and loads seeds only when configured. `supabase/seed/menu.seed.sql` exists, but `supabase/config.toml` has an empty `sql_paths` list, so it is not loaded. Do not treat its illustrative menu rows as verified restaurant data. Do not use `supabase link`, `db push`, `--linked`, or hosted project credentials as part of local development. `supabase/config.toml` enables anonymous Auth locally. Stop local containers with `npm run db:stop`.

Environment names in `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: placeholders for the browser Supabase client used by `/join`; set local values in the ignored `.env.local` file.
- `SUPABASE_SECRET_KEY`: server-only. Never add a `NEXT_PUBLIC_` prefix, use it in a client component, or commit its value.

`.gitignore` excludes local `.env*` files except this blank template. Do not put credentials into the template.

## Backend foundation and boundaries

The ordered migrations under `supabase/migrations/` define dining tables, table sessions, revocable session-scoped QR invites (SHA-256 token hash only), anonymous-auth guest membership, menu structures, per-guest cart lines within batches, multiple orders per session, order-item snapshots, order status events, and explicit staff assignments. Prices use integer paise. No menu seed is configured or loaded locally; the existing seed file contains illustrative rows, not verified restaurant data.

`public.join_table_session(text)` is an authenticated-only Postgres RPC for ARY-23. It derives identity from the verified JWT via `auth.uid()`, requires the anonymous-user JWT claim, hashes the supplied token inside Postgres, and rejects malformed, unknown, expired, revoked, inactive-table, or closed-session invites with one generic error. It returns only session ID and table-local guest number/label. A session-row lock serializes joins and guest-number allocation; retries by an existing member are idempotent while the invite remains valid. The function accepts no user or membership ID. It is `SECURITY DEFINER` with an empty search path, explicitly checks Auth identity, and has execute revoked from `PUBLIC` and `anon` and granted to `authenticated` only.

Migration `05_staff_session_invite_management` adds three trusted database commands: `open_table_session(uuid)`, `issue_table_invite(uuid, integer)`, and `revoke_table_invite(uuid)`. Each requires a verified, non-anonymous Auth JWT and an active `staff_members` assignment with an explicit `staff`, `manager`, or `owner` role. The caller cannot supply a staff ID or role. Session opening locks the table row and retains the partial unique index as a second concurrency guard; inactive tables and duplicate open sessions are rejected.

Invite issuance also performs replacement: under a session lock it revokes the prior invite and inserts the new one atomically. Expiry is restricted to 60 seconds through 24 hours (default one hour), and both the session and dining table must remain active. Tokens are generated inside Postgres from 32 cryptographically random bytes, returned once to the trusted caller, and stored only as SHA-256 hashes. Revocation is explicit. These RPCs return no hashes or staff details. The session UUID is an identifier, not a credential.

Staff assignments have no client-facing registration or write policy. Staff commands require a verified permanent Auth user with an active `staff`, `manager`, or `owner` assignment. A trusted database operator provisions the initial owner and manages assignments through a protected database administration channel. Never put a service-role key or database credential in browser code. The join RPC contract and customer UI remain unchanged.

RLS is enabled on all business tables. Anonymous users can read only published/available menu rows. Authenticated users can read session data only when their `auth.uid()` has a membership in that session; staff reads additionally require an active `staff_members` row. Invite rows have no API table access. Guest roles have no direct table insert, update, or delete grants. Guest writes use dedicated RPCs: `join_table_session` creates membership, and `add_to_cart` validates anonymous identity, membership, session/table status, item availability, and quantity before storing the current database base price. The frontend does not call `add_to_cart`; option-price validation, cart update/removal, order submission, and order-status mutations are not implemented. Session/invite changes are available only through the guarded staff RPCs. Possessing a session UUID is not authorization.

Although `add_to_cart` exists as a database RPC, the frontend is not connected to it, and customization option pricing is not implemented. Order submission still needs an atomic trusted operation: lock the session and active batch, re-check member/session state, current menu availability and option rules, calculate prices from database menu records, and write paise totals/snapshots. Submission must use a session-scoped idempotency key, create one order for the submitted batch, mark that batch immutable, and create a fresh active batch in the same transaction. Session closure must separately prevent all later mutations. Staff commands must verify an active explicit staff assignment and enforce allowed order status transitions.

Realtime is not configured or verified. Before enabling it, add private channel authorization that checks Auth identity and table membership (or staff assignment), then test reconnects with an authoritative state refresh. A channel topic or session UUID alone must never grant access.

## Migrations, tests, and rollback

Foundation migration sequence (this lists only the initial foundation migrations):

1. `01_core_schema`: tables, relationships, constraints, and indexes.
2. `02_security_rls`: helper predicates, RLS, and restrictive grants/read policies.
3. `03_immutability_guards`: immutable submitted batches and order snapshots/events.
4. `04_guest_invite_join`: anonymous-user invite validation and membership creation.
5. `05_staff_session_invite_management`: staff-only session opening and atomic invite issuance/replacement/revocation.
6. `06_tighten_staff_membership_reads`: removes broad staff-list reads and makes the permanent-user JWT check fail closed.

Run migrations without resetting existing local data using `npx supabase migration up --local`. Run pgTAP with `npm run db:test`. The local end-to-end tests use local Auth and clean up their fixtures: `npm run db:test:join` tests guest joining, while `npm run db:test:staff` tests verified staff authorization, inactive staff/table rejection, concurrent session opens, secure token issuance/hash storage, atomic concurrent invite replacement, and revocation. The foundation tests cover table presence, RLS, grants, key constraints, and guards. Still required before full ordering integration: member/nonmember read assertions; concurrent cart mutations; changed prices and unavailable items; duplicate order submissions; multiple orders; staff-only order transitions; and Realtime reconnect plus authoritative state refresh.

Rollback locally with `npm run db:reset` after editing/reverting local migration files; this recreates the local database and loses local data. Do not rewrite an already-applied migration in a shared environment. For any future hosted environment, use a reviewed forward migration with a data-preserving rollback plan. No production database is linked or configured here.

## Current prototype boundaries

- The basket is stored only in the current browser session and does not synchronize across devices.
- Checkout, split calculations, and order tracking remain demonstrations. No payment is collected, and kitchen updates are not connected.
- No customer account or personal information is required by the prototype.
- Food photos and typefaces load from external image and font hosts.
