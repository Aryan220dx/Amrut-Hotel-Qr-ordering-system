# Hotel Amrut guest ordering prototype

A mobile-first guest ordering demo for Hotel Amrut in Karwar, built with Next.js and Supabase. It supports anonymous QR joining, database-backed menu reads, a shared cart, simulated checkout, order confirmation and status tracking. No hosted Supabase project is linked, and menu content remains illustrative rather than restaurant-verified.

## Verification and current local database state

The application and SQL workflow have been verified against a separate disposable local Supabase project: all 20 repository migrations applied there, six pgTAP files passed 96 assertions, schema lint reported no errors, and the 12-guest cart concurrency check passed. This did not migrate or seed the existing local database, and it did not verify the end-to-end guest ordering browser journey.

The existing local database was reconciled on 2026-10-14. Its ledger now contains all 20 repository migrations through `20261014130000`. The earlier `add_to_cart` ACL drift was not attributable to a specific historical operation; the forward ACL migrations normalized it. All eight cart/order RPCs now grant effective execution only to `authenticated`, with no `PUBLIC` ACL entry. The existing 24 menu items and 15 images were preserved; no demo seed was run. The end-to-end guest ordering browser journey remains unverified.

Browser check on 2026-10-14: an earlier headless Firefox capture showed initial loading placeholders but could not verify hydration. A later clean-profile Chromium pass confirmed `/`, `/join`, and `/staff` settle after hydration, with no browser console/runtime errors. The local `v_menu_items` request returned 24 rows; the guest menu UI remains behind table joining. The Data API requests were confirmed to use the local Supabase host. No owner-authorized staff login was available to this verification run, so no staff management RPC was called, no invite was issued, and no guest join, shared-cart, checkout, idempotency, or order-tracking flow was tested. The local staff page now requires `NEXT_PUBLIC_DEMO_TABLE_IDS` to be set to owner-designated demo table UUIDs before it can manage a table. Do not share staff credentials or invite tokens in chat.

## Run the prototype

```bash
npm install
npm run dev
```

For a same-Wi-Fi phone demo, start the local app with `npm run dev:lan` and open the host computer's Wi-Fi IPv4 address on port `3000` from the staff device. Set `NEXT_PUBLIC_LAN_ORIGIN` in ignored `.env.local` to that address (for example, `http://192.168.0.194:3000`) so invites issued from a localhost staff page still produce phone-usable QR codes. Issue a fresh invite there, then scan its QR with each guest phone's built-in camera. Keep the phones and host on the same Wi-Fi. When the configured Supabase URL is loopback (`localhost` or `127.0.0.1`), browser clients opened through the host's LAN address automatically use that same host and Supabase API port. Do not use a `localhost` invite link on a phone; `localhost` on a phone points back to the phone itself. This is for a trusted local demo network, not public hosting.

For the local staff invite tool at `/staff`, set `NEXT_PUBLIC_DEMO_TABLE_IDS` in your local environment to a comma-separated list of UUIDs for owner-designated demo tables. Only those tables appear in its selector; this is a UI allowlist, while the database RPCs remain authoritative for staff authorization. The page uses the same browser Supabase client and public URL/publishable key as `/join`, with existing email/password Auth accounts only. It has no signup, password creation, or staff-role assignment. A trusted database operator must provision or authorize staff separately. The database checks the active staff assignment again in `open_table_session` and `issue_table_invite`. The invite token is shown once in a link fragment, held only in page memory, and cleared on refresh or sign-out. Issuing a replacement revokes the previous invite. Staff and guests should use separate browser profiles: signing out an anonymous guest can prevent that profile from restoring its table membership.

`/join` accepts invite links with a URL fragment (`/join#token=…`) and legacy query-string links, removes the token from the visible URL before authentication, signs guests in anonymously, and calls `join_table_session`. The app stores only the session identifier locally and rechecks Auth, membership, table activity and session status on load and when the page regains focus. The `/` route then shows that joined table’s menu and shared cart.

The menu loads from Supabase (`v_menu_items` plus its option groups). The repository’s sample seed and migration-provided tags/image references are illustrative and unverified; restaurant staff must confirm the menu, prices and availability before launch. Cart add/update/remove calls use server RPCs, with server-side option validation and paise pricing. Guests see each other’s cart through database reads refreshed every three seconds while the page is open; this is polling, not Realtime. Guests can change only their own cart lines.

Checkout submits the current shared batch with a retry-safe idempotency key. The database snapshots order items and customizations, validates current prices and availability, persists one/equal/by-contribution allocation records, closes that batch and creates a new active batch. No payment credentials are collected and no payment is processed. Order tracking reads the authorized order status every five seconds while open. Staff status changes have a guarded RPC and event records; the local staff page currently supports session and invite setup, not order-status management.

## Supabase local development

Requirements: Docker Desktop or another Docker-compatible runtime, Node.js 20+, and npm. The Supabase CLI is pinned as an exact development dependency (`supabase@2.120.0`) in `package.json` and `package-lock.json`.

Start the existing local stack, check its status, then start the app:

```bash
npm run db:start
npm run db:status
npm run dev
```

The current local database has no pending migrations. For later reviewed migration changes, use `npx supabase migration up --local` to apply pending migrations without resetting. Configure the local browser URL and publishable key in ignored `.env.local`; keep those values private. Run database tests only against the intended local project or a disposable isolated database. `db:reset` destroys and recreates the selected local database and is only for disposable data.

`supabase/seed/menu.seed.sql` contains illustrative data and is not configured in `supabase/config.toml` (`enabled = false`, `sql_paths = []`). It has not been run as part of this verification. Do not treat those menu rows as restaurant-approved content. Do not use `supabase link`, `db push`, `--linked`, or hosted project credentials as part of local development. Anonymous Auth is enabled locally. Stop only the intended local stack with `npm run db:stop`.

Environment names in `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: placeholders for the browser Supabase client used by `/join` and `/staff`; set local values in the ignored `.env.local` file.
- `NEXT_PUBLIC_DEMO_TABLE_IDS`: comma-separated owner-designated local demo table UUIDs shown in the `/staff` selector. This client-visible list is not an authorization boundary; staff RPCs validate the active assignment in the database.
- `SUPABASE_SECRET_KEY`: server-only. Never add a `NEXT_PUBLIC_` prefix, use it in a client component, or commit its value.

`.gitignore` excludes local `.env*` files except this blank template. Do not put credentials into the template.

## Backend foundation and boundaries

The ordered migrations under `supabase/migrations/` define dining tables, table sessions, revocable session-scoped QR invites (SHA-256 token hash only), anonymous-auth guest membership, menu structures, per-guest cart lines within batches, multiple orders per session, order-item snapshots, order allocations, order status events, and explicit staff assignments. Prices use integer paise. The menu enhancement migration adds the menu view, images and customization schema; its image references and tags are illustrative and unverified. The later image-invariant migration enforces unique image URLs per item and at most one primary image per item without deleting existing rows.

`public.join_table_session(text)` is an authenticated-only Postgres RPC for ARY-23. It derives identity from the verified JWT via `auth.uid()`, requires the anonymous-user JWT claim, hashes the supplied token inside Postgres, and rejects malformed, unknown, expired, revoked, inactive-table, or closed-session invites with one generic error. It returns only session ID and table-local guest number/label. A session-row lock serializes joins and guest-number allocation; retries by an existing member are idempotent while the invite remains valid. The function accepts no user or membership ID. It is `SECURITY DEFINER` with an empty search path, explicitly checks Auth identity, and has execute revoked from `PUBLIC` and `anon` and granted to `authenticated` only.

Migration `05_staff_session_invite_management` adds three trusted database commands: `open_table_session(uuid)`, `issue_table_invite(uuid, integer)`, and `revoke_table_invite(uuid)`. Each requires a verified, non-anonymous Auth JWT and an active `staff_members` assignment with an explicit `staff`, `manager`, or `owner` role. The caller cannot supply a staff ID or role. Session opening locks the table row and retains the partial unique index as a second concurrency guard; inactive tables and duplicate open sessions are rejected.

Invite issuance also performs replacement: under a session lock it revokes the prior invite and inserts the new one atomically. Expiry is restricted to 60 seconds through 24 hours (default one hour), and both the session and dining table must remain active. Tokens are generated inside Postgres from 32 cryptographically random bytes, returned once to the trusted caller, and stored only as SHA-256 hashes. Revocation is explicit. These RPCs return no hashes or staff details. The session UUID is an identifier, not a credential.

Staff assignments have no client-facing registration or write policy. Staff commands require a verified permanent Auth user with an active `staff`, `manager`, or `owner` assignment. A trusted database operator provisions the initial owner and manages assignments through a protected database administration channel. Never put a service-role key or database credential in browser code. Staff RPCs support session open and invite issue/revoke; order status changes are available only through the authorized status RPC.

RLS is enabled on business tables. Anonymous users can read only published/available menu rows. Authenticated users can read session and order data only when their `auth.uid()` belongs to that session; staff reads require an active `staff_members` row. Invite rows have no API table access. Guests have no direct table write grants. Cart/order guest writes use guarded RPCs: `add_to_cart` validates anonymous identity, membership, open session/table, item/option availability and quantity, then calculates price from database records. `update_cart_line` and `remove_cart_line` enforce line ownership; `clear_cart` removes only the caller’s contribution. `submit_order` validates prices again, stores immutable snapshots and split allocations, handles idempotent retries, and starts the next batch atomically. `get_order_status` checks membership or staff authorization; `update_order_status` requires an active staff role and records status events. Possessing a session or order UUID is not authorization.

The app uses one Supabase browser-client instance per browser tab. Shared-cart and order-status refresh use polling (three and five seconds respectively); Supabase Realtime is not configured or claimed. Session validation runs after refresh/focus. A closed session rejects new cart mutations and new order submissions, while existing authorized members can still read its order history.

## Migrations, tests, and rollback

Foundation migration sequence (this lists only the initial foundation migrations):

1. `01_core_schema`: tables, relationships, constraints, and indexes.
2. `02_security_rls`: helper predicates, RLS, and restrictive grants/read policies.
3. `03_immutability_guards`: immutable submitted batches and order snapshots/events.
4. `04_guest_invite_join`: anonymous-user invite validation and membership creation.
5. `05_staff_session_invite_management`: staff-only session opening and atomic invite issuance/replacement/revocation.
6. `06_tighten_staff_membership_reads`: removes broad staff-list reads and makes the permanent-user JWT check fail closed.

Run pgTAP only against a disposable local database after its migrations are applied. The SQL test files cover foundation/RLS, guest joining, staff session/invite management, cart RPC ACLs, cart/order security metadata, and cart/order workflows. The workflow tests validate server prices, membership access, own-line mutation, own-contribution clearing, stale prices, unavailable items, idempotent submissions, multiple orders, allocation totals, cross-session order denial, active-staff status transitions/events and closed-session rejection. In the isolated verification run, all six files passed 96 assertions. `npm run db:test:concurrency -- --workdir /absolute/path/to/amrut-isolated-test` makes 12 parallel cart additions and requires the supplied local project's `project_id` to contain `test` or `isolated`; it creates and removes disposable Auth/database fixtures.

The staff management fixture script is `npm run db:test:staff`. It requires the local Supabase stack to be running with the staff migrations applied, local email signup and anonymous Auth enabled, and the pinned CLI/dependencies installed. It verifies that the API URL is loopback, creates three permanent Auth users plus one anonymous user, inserts fixture tables/session/staff assignments, exercises session and invite RPCs including concurrent invite rotation, and attempts to remove its generated rows and users in `finally`. Run it only against a disposable local database; cleanup failure can leave fixtures behind. It was not run during this verification. `npm run db:test:join` is also fixture-based and should be limited to an isolated local database. Unit tests cover staff RPC response validation, fragment invite-link construction, demo table ID parsing, order submission state, safe order links, status mapping and single-flight refresh behavior.

Rollback locally with `npm run db:reset` after editing/reverting local migration files; this recreates the local database and loses local data. Do not rewrite an already-applied migration in a shared environment. For any future hosted environment, use a reviewed forward migration with a data-preserving rollback plan. No production database is linked or configured here.

## Current prototype boundaries

- Menu data, prices, tags and images are unverified demo content until approved by the restaurant.
- Shared cart reads are polled every three seconds; Supabase Realtime is not enabled.
- Split payment records are simulated allocations only; no money is collected or transferred.
- The local staff page includes a table-scoped order board and guarded Preparing → Ready → Served controls; there is no kitchen integration.
- No customer account or personal information is required by the prototype.
- Food photos and typefaces load from external image and font hosts.
- The end-to-end browser journey remains unverified pending a trusted staff session and valid invite. Payment remains simulated throughout.
