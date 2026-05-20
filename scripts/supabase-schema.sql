create extension if not exists pgcrypto;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

create table if not exists public.photographers (
  id text primary key,
  name text not null check (char_length(name) between 1 and 100),
  email text not null unique check (char_length(email) <= 256),
  bio text not null default '' check (char_length(bio) <= 1000),
  avatar text not null default '',
  phone text,
  cpf text,
  verified boolean not null default false,
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
  duration text,
  "storagePath" text,
  status text not null default 'published' check (status in ('draft', 'published', 'removed')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  "userId" text,
  "buyerName" text not null check (char_length("buyerName") between 1 and 180),
  "buyerEmail" text not null check (char_length("buyerEmail") <= 256),
  "buyerPhone" text not null check (char_length("buyerPhone") <= 32),
  "buyerCpf" text not null check ("buyerCpf" ~ '^[0-9]{11}$'),
  total numeric(10, 2) not null check (total > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  "paymentProvider" text not null default 'infinitepay',
  "paymentExternalId" text,
  "checkoutUrl" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

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

create table if not exists public.platform_settings (
  id text primary key default 'default' check (id = 'default'),
  "platformFeePercent" numeric(5, 2) not null default 30 check ("platformFeePercent" >= 0 and "platformFeePercent" <= 100),
  "withdrawalFee" numeric(10, 2) not null default 5 check ("withdrawalFee" >= 0),
  "autoBlockSuspicious" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists products_bib_idx on public.products (bib);
create index if not exists products_vendedor_id_idx on public.products ("vendedorId");
create index if not exists products_created_at_idx on public.products ("createdAt" desc);
create index if not exists products_status_idx on public.products (status);
create index if not exists photographers_email_idx on public.photographers (email);
create index if not exists photographers_verified_idx on public.photographers (verified);
create index if not exists orders_user_id_idx on public.orders ("userId");
create index if not exists orders_buyer_email_idx on public.orders ("buyerEmail");
create index if not exists orders_status_idx on public.orders (status);
create index if not exists order_items_order_id_idx on public.order_items ("orderId");
create index if not exists order_items_product_id_idx on public.order_items ("productId");
create index if not exists payment_events_order_id_idx on public.payment_events ("orderId");
create index if not exists payment_events_provider_event_id_idx on public.payment_events (provider, "eventId");

insert into public.platform_settings (id, "platformFeePercent", "withdrawalFee", "autoBlockSuspicious")
values ('default', 30, 5, true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'funpace-media',
  'funpace-media',
  true,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists photographers_set_updated_at on public.photographers;
create trigger photographers_set_updated_at
before update on public.photographers
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

alter table public.photographers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_events enable row level security;
alter table public.platform_settings enable row level security;

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
  or exists (
    select 1
    from public.orders o
    where o.id = "orderId"
      and (
        (o."userId" is not null and o."userId" = auth.uid()::text)
        or o."buyerEmail" = (auth.jwt() ->> 'email')
      )
  )
);

drop policy if exists "payment_events_select_admin_only" on public.payment_events;
create policy "payment_events_select_admin_only"
on public.payment_events
for select
using (public.is_admin());

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

drop policy if exists "media_select_public" on storage.objects;
create policy "media_select_public"
on storage.objects
for select
using (bucket_id = 'funpace-media');

drop policy if exists "media_insert_verified_owner_folder" on storage.objects;
create policy "media_insert_verified_owner_folder"
on storage.objects
for insert
with check (
  bucket_id = 'funpace-media'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.photographers p
    where p.id = auth.uid()::text
      and p.verified = true
  )
);

drop policy if exists "media_update_owner_folder_or_admin" on storage.objects;
create policy "media_update_owner_folder_or_admin"
on storage.objects
for update
using (
  bucket_id = 'funpace-media'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'funpace-media'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

drop policy if exists "media_delete_owner_folder_or_admin" on storage.objects;
create policy "media_delete_owner_folder_or_admin"
on storage.objects
for delete
using (
  bucket_id = 'funpace-media'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
