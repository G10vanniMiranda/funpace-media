create extension if not exists pgcrypto;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'), false)
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', false)
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_super_admin() to service_role;

create or replace function public.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = required_role, false)
$$;

revoke all on function public.has_role(text) from public;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.has_role(text) to service_role;

create or replace function public.is_verified_photographer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.photographers p
    where p.id = auth.uid()::text
      and p.verified = true
  )
$$;

revoke all on function public.is_verified_photographer() from public;
grant execute on function public.is_verified_photographer() to authenticated;
grant execute on function public.is_verified_photographer() to service_role;

create table if not exists public.photographers (
  id text primary key,
  name text not null check (char_length(name) between 1 and 100),
  email text not null unique check (char_length(email) <= 256),
  bio text not null default '' check (char_length(bio) <= 1000),
  avatar text not null default '',
  phone text,
  instagram text check (instagram is null or char_length(instagram) <= 30),
  cpf text,
  verified boolean not null default false,
  role text not null default 'photographer' check (role in ('photographer')),
  "commissionPercent" numeric(5, 2) check ("commissionPercent" is null or ("commissionPercent" >= 0 and "commissionPercent" <= 100)),
  "blockedAt" timestamptz,
  "lastLoginAt" timestamptz,
  stats jsonb not null default jsonb_build_object(
    'photos', 0,
    'events', 0,
    'rating', 5,
    'totalEarnings', 0,
    'pendingEarnings', 0,
    'salesCount', 0
  ),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.photographers add column if not exists role text not null default 'photographer';
alter table public.photographers add column if not exists "commissionPercent" numeric(5, 2);
alter table public.photographers add column if not exists "blockedAt" timestamptz;
alter table public.photographers add column if not exists "lastLoginAt" timestamptz;
alter table public.photographers add column if not exists instagram text check (instagram is null or char_length(instagram) <= 30);

create table if not exists public.customers (
  id text primary key,
  email text not null unique check (char_length(email) <= 256),
  name text not null default '' check (char_length(name) <= 180),
  phone text,
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  "avatarUrl" text,
  preferences jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.customers add column if not exists "avatarUrl" text;
alter table public.customers add column if not exists preferences jsonb not null default '{}'::jsonb;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 180),
  price numeric(10, 2) not null check (price > 0),
  url text not null check (char_length(url) <= 2048),
  type text not null check (type in ('IMG', 'VIDEO', 'VIEW')),
  "vendedorId" text not null references public.photographers(id) on delete cascade,
  bib text not null default '' check (char_length(bib) <= 32),
  event text not null default '' check (char_length(event) <= 180),
  checkpoint text not null default '' check (char_length(checkpoint) <= 120),
  "thumbnailUrl" text,
  "watermarkUrl" text,
  duration text,
  "storagePath" text,
  status text not null default 'published' check (status in ('draft', 'pending', 'processing', 'published', 'sold', 'hidden', 'removed')),
  "viewCount" integer not null default 0 check ("viewCount" >= 0),
  "salesCount" integer not null default 0 check ("salesCount" >= 0),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.products add column if not exists "watermarkUrl" text;
alter table public.products add column if not exists "viewCount" integer not null default 0;
alter table public.products add column if not exists "salesCount" integer not null default 0;

do $$
begin
  alter table public.products drop constraint if exists products_status_check;
  alter table public.products add constraint products_status_check
    check (status in ('draft', 'pending', 'processing', 'published', 'sold', 'hidden', 'removed'));
exception
  when undefined_table then
    null;
end $$;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  "photographerId" text references public.photographers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  slug text unique,
  description text,
  date date not null,
  location text,
  checkpoint text,
  "coverImage" text,
  "bannerImage" text,
  "defaultPrice" numeric(10, 2) check ("defaultPrice" is null or "defaultPrice" > 0),
  "isPublished" boolean not null default true,
  "isFeatured" boolean not null default false,
  "moderationStatus" text not null default 'approved' check ("moderationStatus" in ('pending', 'approved', 'rejected')),
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'closed')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.events add column if not exists "photographerId" text references public.photographers(id) on delete cascade;
alter table public.events add column if not exists slug text unique;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists "coverImage" text;
alter table public.events add column if not exists "bannerImage" text;
alter table public.events add column if not exists "defaultPrice" numeric(10, 2);
alter table public.events add column if not exists "isPublished" boolean not null default true;
alter table public.events add column if not exists "isFeatured" boolean not null default false;
alter table public.events add column if not exists "moderationStatus" text not null default 'approved';

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  "userId" text,
  "buyerName" text not null check (char_length("buyerName") between 1 and 180),
  "buyerEmail" text not null check (char_length("buyerEmail") <= 256),
  "buyerPhone" text not null check (char_length("buyerPhone") <= 32),
  "buyerCpf" text not null check ("buyerCpf" ~ '^[0-9]{11}$'),
  total numeric(10, 2) not null check (total > 0),
  subtotal numeric(10, 2),
  "discountTotal" numeric(10, 2) not null default 0 check ("discountTotal" >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'canceled', 'refused', 'refunded')),
  "paymentMethod" text not null default 'checkout' check ("paymentMethod" in ('pix', 'credit_card', 'checkout')),
  "paymentProvider" text not null default 'infinitepay',
  "paymentExternalId" text,
  "checkoutUrl" text,
  "paidEmailSentAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.orders add column if not exists subtotal numeric(10, 2);
alter table public.orders add column if not exists "discountTotal" numeric(10, 2) not null default 0;
alter table public.orders add column if not exists "paymentMethod" text not null default 'checkout';
alter table public.orders add column if not exists "paidEmailSentAt" timestamptz;

do $$
begin
  alter table public.orders drop constraint if exists orders_status_check;
  alter table public.orders add constraint orders_status_check
    check (status in ('pending', 'paid', 'failed', 'cancelled', 'canceled', 'refused', 'refunded'));
exception
  when undefined_table then
    null;
end $$;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  "orderId" uuid not null references public.orders(id) on delete cascade,
  "productId" uuid not null references public.products(id),
  name text not null,
  type text not null check (type in ('IMG', 'VIDEO', 'VIEW')),
  price numeric(10, 2) not null check (price > 0),
  url text not null,
  "vendedorId" text not null,
  bib text not null default '',
  event text not null default '',
  checkpoint text not null default '',
  "thumbnailUrl" text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'infinitepay',
  "eventId" text not null,
  "orderId" uuid references public.orders(id) on delete set null,
  status text,
  payload jsonb not null,
  "createdAt" timestamptz not null default now(),
  unique (provider, "eventId")
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  "orderId" uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  "providerPaymentId" text not null,
  method text not null default 'checkout' check (method in ('pix', 'credit_card', 'checkout')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'canceled', 'refused', 'refunded')),
  "rawResponse" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique (provider, "providerPaymentId")
);

create table if not exists public.download_access (
  id uuid primary key default gen_random_uuid(),
  "orderId" uuid not null references public.orders(id) on delete cascade,
  "photoId" uuid not null references public.products(id) on delete cascade,
  "orderItemId" uuid references public.order_items(id) on delete cascade,
  "userId" text,
  "customerEmail" text not null check (char_length("customerEmail") <= 256),
  "isActive" boolean not null default true,
  "expiresAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("orderId", "photoId")
);

do $$
begin
  alter table public.payments drop constraint if exists payments_status_check;
  alter table public.payments add constraint payments_status_check
    check (status in ('pending', 'paid', 'failed', 'cancelled', 'canceled', 'refused', 'refunded'));
exception
  when undefined_table then
    null;
end $$;

create table if not exists public.download_events (
  id uuid primary key default gen_random_uuid(),
  "orderId" uuid not null references public.orders(id) on delete cascade,
  "orderItemId" uuid not null references public.order_items(id) on delete cascade,
  "productId" uuid not null references public.products(id) on delete cascade,
  "vendedorId" text not null references public.photographers(id) on delete cascade,
  "buyerEmail" text not null check (char_length("buyerEmail") <= 256),
  "userId" text,
  "ipHash" text,
  "userAgent" text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.product_likes (
  "productId" uuid not null references public.products(id) on delete cascade,
  "visitorId" text not null check (char_length("visitorId") between 1 and 80),
  "createdAt" timestamptz not null default now(),
  primary key ("productId", "visitorId")
);

create table if not exists public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  "userId" text not null,
  "customerEmail" text not null check (char_length("customerEmail") <= 256),
  "photoId" uuid not null references public.products(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  unique ("userId", "photoId")
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  "userId" text not null,
  "userAgent" text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  "userId" text,
  "orderId" uuid not null references public.orders(id) on delete cascade,
  "photoId" uuid not null references public.products(id) on delete cascade,
  "downloadedAt" timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  "photographerId" text not null references public.photographers(id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  "pixKey" text not null check (char_length("pixKey") between 3 and 180),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected', 'cancelled')),
  note text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "processedAt" timestamptz
);

create table if not exists public.photographer_wallets (
  id uuid primary key default gen_random_uuid(),
  "photographerId" text not null unique references public.photographers(id) on delete cascade,
  balance numeric(10, 2) not null default 0 check (balance >= 0),
  "pendingBalance" numeric(10, 2) not null default 0 check ("pendingBalance" >= 0),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.photographer_transactions (
  id uuid primary key default gen_random_uuid(),
  "photographerId" text not null references public.photographers(id) on delete cascade,
  "orderId" uuid references public.orders(id) on delete set null,
  "orderItemId" uuid references public.order_items(id) on delete set null,
  "grossAmount" numeric(10, 2) not null check ("grossAmount" >= 0),
  "platformFee" numeric(10, 2) not null default 0 check ("platformFee" >= 0),
  "netAmount" numeric(10, 2) not null check ("netAmount" >= 0),
  status text not null default 'pending' check (status in ('pending', 'available', 'paid', 'cancelled')),
  "createdAt" timestamptz not null default now(),
  unique ("orderItemId")
);

alter table public.photographer_transactions add column if not exists "orderItemId" uuid references public.order_items(id) on delete set null;

create table if not exists public.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid references public.products(id) on delete cascade,
  "photographerId" text not null references public.photographers(id) on delete cascade,
  kind text not null default 'watermark' check (kind in ('thumbnail', 'watermark', 'optimization')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  "sourceUrl" text,
  "outputUrl" text,
  error text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,40}$'),
  type text not null check (type in ('percent', 'fixed')),
  value numeric(10, 2) not null check (value > 0),
  "maxUses" integer check ("maxUses" is null or "maxUses" > 0),
  "usedCount" integer not null default 0 check ("usedCount" >= 0),
  "startsAt" timestamptz,
  "expiresAt" timestamptz,
  "isActive" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  "actorId" text,
  "actorEmail" text,
  action text not null check (char_length(action) between 2 and 120),
  "targetType" text,
  "targetId" text,
  metadata jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id text primary key default 'default' check (id = 'default'),
  "platformFeePercent" numeric(5, 2) not null default 30 check ("platformFeePercent" >= 0 and "platformFeePercent" <= 100),
  "withdrawalFee" numeric(10, 2) not null default 5 check ("withdrawalFee" >= 0),
  "autoBlockSuspicious" boolean not null default true,
  "paymentProvider" text not null default 'infinitepay',
  "brandName" text not null default 'Funpace Media',
  "supportEmail" text,
  "maxUploadBytes" bigint not null default 314572800,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.platform_settings add column if not exists "paymentProvider" text not null default 'infinitepay';
alter table public.platform_settings add column if not exists "brandName" text not null default 'Funpace Media';
alter table public.platform_settings add column if not exists "supportEmail" text;
alter table public.platform_settings add column if not exists "maxUploadBytes" bigint not null default 314572800;

create index if not exists products_bib_idx on public.products (bib);
create index if not exists products_vendedor_id_idx on public.products ("vendedorId");
create index if not exists products_created_at_idx on public.products ("createdAt" desc);
create index if not exists products_status_idx on public.products (status);
create index if not exists products_event_idx on public.products (event);
create index if not exists events_date_idx on public.events (date);
create index if not exists events_status_idx on public.events (status);
create index if not exists events_photographer_id_idx on public.events ("photographerId");
create index if not exists events_slug_idx on public.events (slug);
create index if not exists photographers_email_idx on public.photographers (email);
create index if not exists photographers_verified_idx on public.photographers (verified);
create index if not exists customers_email_idx on public.customers (email);
create index if not exists orders_user_id_idx on public.orders ("userId");
create index if not exists orders_buyer_email_idx on public.orders ("buyerEmail");
create index if not exists orders_status_idx on public.orders (status);
create index if not exists order_items_order_id_idx on public.order_items ("orderId");
create index if not exists order_items_product_id_idx on public.order_items ("productId");
create index if not exists payment_events_order_id_idx on public.payment_events ("orderId");
create index if not exists payment_events_provider_event_id_idx on public.payment_events (provider, "eventId");
create index if not exists payments_order_id_idx on public.payments ("orderId");
create index if not exists payments_status_idx on public.payments (status);
create index if not exists download_access_order_id_idx on public.download_access ("orderId");
create index if not exists download_access_photo_id_idx on public.download_access ("photoId");
create index if not exists download_access_customer_email_idx on public.download_access ("customerEmail");
create index if not exists download_events_vendedor_id_idx on public.download_events ("vendedorId");
create index if not exists download_events_order_item_id_idx on public.download_events ("orderItemId");
create index if not exists download_events_created_at_idx on public.download_events ("createdAt" desc);
create index if not exists product_likes_product_id_idx on public.product_likes ("productId");
create index if not exists customer_favorites_user_id_idx on public.customer_favorites ("userId");
create index if not exists customer_favorites_photo_id_idx on public.customer_favorites ("photoId");
create index if not exists user_sessions_user_id_idx on public.user_sessions ("userId");
create index if not exists downloads_user_id_idx on public.downloads ("userId");
create index if not exists downloads_order_id_idx on public.downloads ("orderId");
create index if not exists withdrawal_requests_photographer_id_idx on public.withdrawal_requests ("photographerId");
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status);
create index if not exists withdrawal_requests_created_at_idx on public.withdrawal_requests ("createdAt" desc);
create index if not exists photographer_transactions_photographer_id_idx on public.photographer_transactions ("photographerId");
create index if not exists photographer_transactions_order_id_idx on public.photographer_transactions ("orderId");
create index if not exists photographer_transactions_order_item_id_idx on public.photographer_transactions ("orderItemId");
create unique index if not exists photographer_transactions_order_item_unique
on public.photographer_transactions ("orderItemId")
where "orderItemId" is not null;
create index if not exists photographer_transactions_created_at_idx on public.photographer_transactions ("createdAt" desc);
create index if not exists media_processing_jobs_photographer_id_idx on public.media_processing_jobs ("photographerId");
create index if not exists media_processing_jobs_product_id_idx on public.media_processing_jobs ("productId");
create index if not exists media_processing_jobs_status_idx on public.media_processing_jobs (status);
create index if not exists coupons_code_idx on public.coupons (code);
create index if not exists coupons_active_idx on public.coupons ("isActive");
create index if not exists admin_activity_logs_created_at_idx on public.admin_activity_logs ("createdAt" desc);
create index if not exists admin_activity_logs_action_idx on public.admin_activity_logs (action);

insert into public.platform_settings (id, "platformFeePercent", "withdrawalFee", "autoBlockSuspicious")
values ('default', 30, 5, true)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

drop trigger if exists photographers_set_updated_at on public.photographers;
create trigger photographers_set_updated_at
before update on public.photographers
for each row execute function public.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists download_access_set_updated_at on public.download_access;
create trigger download_access_set_updated_at
before update on public.download_access
for each row execute function public.set_updated_at();

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

drop trigger if exists withdrawal_requests_set_updated_at on public.withdrawal_requests;
create trigger withdrawal_requests_set_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

drop trigger if exists photographer_wallets_set_updated_at on public.photographer_wallets;
create trigger photographer_wallets_set_updated_at
before update on public.photographer_wallets
for each row execute function public.set_updated_at();

drop trigger if exists media_processing_jobs_set_updated_at on public.media_processing_jobs;
create trigger media_processing_jobs_set_updated_at
before update on public.media_processing_jobs
for each row execute function public.set_updated_at();

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

alter table public.photographers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_events enable row level security;
alter table public.payments enable row level security;
alter table public.download_access enable row level security;
alter table public.download_events enable row level security;
alter table public.product_likes enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.user_sessions enable row level security;
alter table public.downloads enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.platform_settings enable row level security;
alter table public.photographer_wallets enable row level security;
alter table public.photographer_transactions enable row level security;
alter table public.media_processing_jobs enable row level security;
alter table public.coupons enable row level security;
alter table public.admin_activity_logs enable row level security;

drop policy if exists "photographers_select_public_verified_or_owner_or_admin" on public.photographers;
create policy "photographers_select_public_verified_or_owner_or_admin"
on public.photographers
for select
using (verified = true or id = auth.uid()::text or public.is_admin());

drop policy if exists "photographers_insert_own_profile" on public.photographers;
create policy "photographers_insert_own_profile"
on public.photographers
for insert
with check (
  auth.uid() is not null
  and id = auth.uid()::text
  and verified = false
  and email = (auth.jwt() ->> 'email')
  and cpf is not null
  and cpf ~ '^[0-9]{11}$'
);

drop policy if exists "photographers_update_own_non_verified_fields" on public.photographers;
create policy "photographers_update_own_non_verified_fields"
on public.photographers
for update
using (id = auth.uid()::text or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()::text
    and verified = (select p.verified from public.photographers p where p.id = auth.uid()::text)
    and cpf is not null
    and cpf ~ '^[0-9]{11}$'
  )
);

drop policy if exists "customers_select_owner_or_admin" on public.customers;
create policy "customers_select_owner_or_admin"
on public.customers
for select
using (id = auth.uid()::text or public.is_admin());

drop policy if exists "customers_insert_own_profile" on public.customers;
create policy "customers_insert_own_profile"
on public.customers
for insert
with check (
  auth.uid() is not null
  and id = auth.uid()::text
  and email = (auth.jwt() ->> 'email')
);

drop policy if exists "customers_update_owner_or_admin" on public.customers;
create policy "customers_update_owner_or_admin"
on public.customers
for update
using (id = auth.uid()::text or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()::text
    and email = (auth.jwt() ->> 'email')
  )
);

drop policy if exists "products_select_published_owner_or_admin" on public.products;
create policy "products_select_published_owner_or_admin"
on public.products
for select
using (status = 'published' or "vendedorId" = auth.uid()::text or public.is_admin());

drop policy if exists "products_insert_own_verified_photographer" on public.products;
create policy "products_insert_own_verified_photographer"
on public.products
for insert
with check (
  auth.uid() is not null
  and "vendedorId" = auth.uid()::text
  and exists (
    select 1
    from public.photographers p
    where p.id = auth.uid()::text
      and p.verified = true
  )
);

drop policy if exists "products_update_owner_or_admin" on public.products;
create policy "products_update_owner_or_admin"
on public.products
for update
using ("vendedorId" = auth.uid()::text or public.is_admin())
with check ("vendedorId" = auth.uid()::text or public.is_admin());

drop policy if exists "products_delete_owner_or_admin" on public.products;
create policy "products_delete_owner_or_admin"
on public.products
for delete
using ("vendedorId" = auth.uid()::text or public.is_admin());

drop policy if exists "product_likes_service_role_all" on public.product_likes;
create policy "product_likes_service_role_all"
on public.product_likes
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "customer_favorites_owner_all" on public.customer_favorites;
create policy "customer_favorites_owner_all"
on public.customer_favorites
for all
using ("userId" = auth.uid()::text or public.is_admin())
with check (
  public.is_admin()
  or (
    "userId" = auth.uid()::text
    and "customerEmail" = (auth.jwt() ->> 'email')
  )
);

drop policy if exists "user_sessions_owner_or_admin" on public.user_sessions;
create policy "user_sessions_owner_or_admin"
on public.user_sessions
for select
using ("userId" = auth.uid()::text or public.is_admin());

drop policy if exists "downloads_owner_or_admin" on public.downloads;
create policy "downloads_owner_or_admin"
on public.downloads
for select
using ("userId" = auth.uid()::text or public.is_admin());

drop policy if exists "events_select_authenticated" on public.events;
create policy "events_select_authenticated"
on public.events
for select
using (
  auth.uid() is not null
  and (
    "isPublished" = true
    or "photographerId" = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "events_insert_admin_only" on public.events;
drop policy if exists "events_insert_admin_or_owner_photographer" on public.events;
create policy "events_insert_admin_or_owner_photographer"
on public.events
for insert
with check (
  public.is_admin()
  or (
    "photographerId" = auth.uid()::text
    and public.is_verified_photographer()
  )
);

drop policy if exists "events_update_admin_only" on public.events;
drop policy if exists "events_update_admin_or_owner_photographer" on public.events;
create policy "events_update_admin_or_owner_photographer"
on public.events
for update
using (public.is_admin() or "photographerId" = auth.uid()::text)
with check (
  public.is_admin()
  or (
    "photographerId" = auth.uid()::text
    and public.is_verified_photographer()
  )
);

drop policy if exists "events_delete_admin_only" on public.events;
drop policy if exists "events_delete_admin_or_owner_photographer" on public.events;
create policy "events_delete_admin_or_owner_photographer"
on public.events
for delete
using (public.is_admin() or "photographerId" = auth.uid()::text);

drop policy if exists "orders_select_owner_email_or_admin" on public.orders;
create policy "orders_select_owner_email_or_admin"
on public.orders
for select
using (
  public.is_admin()
  or ("userId" is not null and "userId" = auth.uid()::text)
  or ("buyerEmail" = (auth.jwt() ->> 'email'))
);

drop policy if exists "orders_update_admin_only" on public.orders;
create policy "orders_update_admin_only"
on public.orders
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "order_items_select_order_owner_or_admin" on public.order_items;
create policy "order_items_select_order_owner_or_admin"
on public.order_items
for select
using (
  public.is_admin()
  or "vendedorId" = auth.uid()::text
  or exists (
    select 1
    from public.orders o
    where o.id = order_items."orderId"
      and (
        (o."userId" is not null and o."userId" = auth.uid()::text)
        or (o."buyerEmail" = (auth.jwt() ->> 'email'))
      )
  )
);

drop policy if exists "payment_events_select_admin_only" on public.payment_events;
create policy "payment_events_select_admin_only"
on public.payment_events
for select
using (public.is_admin());

drop policy if exists "payments_select_order_owner_or_admin" on public.payments;
create policy "payments_select_order_owner_or_admin"
on public.payments
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders o
    where o.id = payments."orderId"
      and (
        (o."userId" is not null and o."userId" = auth.uid()::text)
        or (o."buyerEmail" = (auth.jwt() ->> 'email'))
      )
  )
);

drop policy if exists "download_access_select_owner_or_admin" on public.download_access;
create policy "download_access_select_owner_or_admin"
on public.download_access
for select
using (
  public.is_admin()
  or ("userId" is not null and "userId" = auth.uid()::text)
  or ("customerEmail" = (auth.jwt() ->> 'email'))
);

drop policy if exists "download_events_select_owner_or_admin" on public.download_events;
create policy "download_events_select_owner_or_admin"
on public.download_events
for select
using (
  public.is_admin()
  or "vendedorId" = auth.uid()::text
);

drop policy if exists "withdrawal_requests_select_owner_or_admin" on public.withdrawal_requests;
create policy "withdrawal_requests_select_owner_or_admin"
on public.withdrawal_requests
for select
using (
  public.is_admin()
  or "photographerId" = auth.uid()::text
);

drop policy if exists "withdrawal_requests_insert_owner" on public.withdrawal_requests;
create policy "withdrawal_requests_insert_owner"
on public.withdrawal_requests
for insert
with check (
  auth.uid() is not null
  and "photographerId" = auth.uid()::text
  and status = 'pending'
  and exists (
    select 1
    from public.photographers p
    where p.id = auth.uid()::text
      and p.verified = true
  )
);

drop policy if exists "withdrawal_requests_update_admin_only" on public.withdrawal_requests;
create policy "withdrawal_requests_update_admin_only"
on public.withdrawal_requests
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "platform_settings_select_admin_only" on public.platform_settings;
create policy "platform_settings_select_admin_only"
on public.platform_settings
for select
using (public.is_admin());

drop policy if exists "platform_settings_update_admin_only" on public.platform_settings;
create policy "platform_settings_update_admin_only"
on public.platform_settings
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "coupons_admin_all" on public.coupons;
create policy "coupons_admin_all"
on public.coupons
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin_activity_logs_admin_select_insert" on public.admin_activity_logs;
create policy "admin_activity_logs_admin_select_insert"
on public.admin_activity_logs
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "photographer_wallets_select_owner_or_admin" on public.photographer_wallets;
create policy "photographer_wallets_select_owner_or_admin"
on public.photographer_wallets
for select
using (public.is_admin() or "photographerId" = auth.uid()::text);

drop policy if exists "photographer_transactions_select_owner_or_admin" on public.photographer_transactions;
create policy "photographer_transactions_select_owner_or_admin"
on public.photographer_transactions
for select
using (public.is_admin() or "photographerId" = auth.uid()::text);

drop policy if exists "media_processing_jobs_select_owner_or_admin" on public.media_processing_jobs;
create policy "media_processing_jobs_select_owner_or_admin"
on public.media_processing_jobs
for select
using (public.is_admin() or "photographerId" = auth.uid()::text);

drop policy if exists "media_processing_jobs_insert_owner_or_admin" on public.media_processing_jobs;
create policy "media_processing_jobs_insert_owner_or_admin"
on public.media_processing_jobs
for insert
with check (
  public.is_admin()
  or (
    "photographerId" = auth.uid()::text
    and public.is_verified_photographer()
  )
);
