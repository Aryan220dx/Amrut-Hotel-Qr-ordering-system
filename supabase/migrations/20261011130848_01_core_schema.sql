-- Core relational model. Customer and staff writes remain disabled until trusted commands exist.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.session_status as enum ('open', 'closed');
create type public.cart_batch_status as enum ('active', 'submitted', 'abandoned');
create type public.order_status as enum ('placed', 'preparing', 'ready', 'served', 'cancelled');
create type public.staff_role as enum ('staff', 'manager', 'owner');

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (length(btrim(label)) between 1 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  dining_table_id uuid not null references public.dining_tables(id) on delete restrict,
  status public.session_status not null default 'open',
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  check ((status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null))
);
create unique index table_sessions_one_open_per_table on public.table_sessions(dining_table_id) where status = 'open';
create index table_sessions_table_history on public.table_sessions(dining_table_id, opened_at desc);

create table public.table_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index table_invites_session on public.table_invites(session_id);
create unique index table_invites_one_unrevoked_per_session on public.table_invites(session_id) where revoked_at is null;

create table public.table_members (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  guest_number integer not null check (guest_number > 0),
  display_label text not null check (length(display_label) between 1 and 32),
  joined_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (session_id, guest_number),
  unique (id, session_id)
);
create index table_members_user_sessions on public.table_members(user_id, session_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique check (length(btrim(item_code)) between 1 and 64),
  category text not null check (length(btrim(category)) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  base_price_paise bigint not null check (base_price_paise >= 0),
  price_version integer not null default 1 check (price_version > 0),
  is_published boolean not null default false,
  is_available boolean not null default false,
  updated_at timestamptz not null default now()
);
create index menu_items_public_listing on public.menu_items(category, name) where is_published and is_available;

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  option_key text not null check (length(btrim(option_key)) between 1 and 64),
  label text not null check (length(btrim(label)) between 1 and 100),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= min_selections),
  sort_order integer not null default 0,
  unique (menu_item_id, option_key),
  unique (id, menu_item_id)
);
create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  option_key text not null check (length(btrim(option_key)) between 1 and 64),
  label text not null check (length(btrim(label)) between 1 and 100),
  price_delta_paise bigint not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  unique (group_id, option_key)
);
create index menu_option_groups_item on public.menu_option_groups(menu_item_id, sort_order);
create index menu_options_group on public.menu_options(group_id, sort_order);

create table public.cart_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  status public.cart_batch_status not null default 'active',
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (id, session_id),
  check ((status = 'submitted' and submitted_at is not null) or (status <> 'submitted' and submitted_at is null))
);
create unique index cart_batches_one_active_per_session on public.cart_batches(session_id) where status = 'active';
create index cart_batches_session_history on public.cart_batches(session_id, created_at desc);

create table public.cart_lines (
  id uuid primary key default gen_random_uuid(),
  cart_batch_id uuid not null references public.cart_batches(id) on delete restrict,
  session_id uuid not null,
  member_id uuid not null,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 99),
  option_selections jsonb not null default '{}'::jsonb check (jsonb_typeof(option_selections) = 'object'),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  price_version integer not null check (price_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cart_batch_id, session_id) references public.cart_batches(id, session_id) on delete restrict,
  foreign key (member_id, session_id) references public.table_members(id, session_id) on delete restrict,
  unique (id, cart_batch_id)
);
create index cart_lines_batch on public.cart_lines(cart_batch_id);
create index cart_lines_member_batch on public.cart_lines(member_id, cart_batch_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  cart_batch_id uuid not null unique,
  idempotency_key uuid not null,
  status public.order_status not null default 'placed',
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  total_paise bigint not null check (total_paise = subtotal_paise),
  placed_by_member_id uuid not null,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, idempotency_key),
  unique (id, session_id),
  foreign key (cart_batch_id, session_id) references public.cart_batches(id, session_id) on delete restrict,
  foreign key (placed_by_member_id, session_id) references public.table_members(id, session_id) on delete restrict
);
create index orders_session_history on public.orders(session_id, placed_at desc);
create index orders_staff_queue on public.orders(status, placed_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  session_id uuid not null,
  source_cart_line_id uuid not null references public.cart_lines(id) on delete restrict,
  contributor_member_id uuid,
  contributor_label_snapshot text not null,
  item_code_snapshot text not null,
  name_snapshot text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  price_version_snapshot integer not null check (price_version_snapshot > 0),
  options_snapshot jsonb not null check (jsonb_typeof(options_snapshot) = 'array'),
  line_total_paise bigint not null check (line_total_paise = unit_price_paise * quantity),
  created_at timestamptz not null default now(),
  unique (order_id, source_cart_line_id),
  foreign key (order_id, session_id) references public.orders(id, session_id) on delete restrict,
  foreign key (contributor_member_id, session_id) references public.table_members(id, session_id) on delete restrict
);
create index order_items_order on public.order_items(order_id);

create table public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_staff_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index order_status_events_order on public.order_status_events(order_id, created_at);

create table public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.staff_role not null,
  is_active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);
