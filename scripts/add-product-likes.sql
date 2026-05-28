create table if not exists public.product_likes (
  "productId" uuid not null references public.products(id) on delete cascade,
  "visitorId" text not null check (char_length("visitorId") between 1 and 80),
  "createdAt" timestamptz not null default now(),
  primary key ("productId", "visitorId")
);

create index if not exists product_likes_product_id_idx on public.product_likes ("productId");

alter table public.product_likes enable row level security;

drop policy if exists "product_likes_service_role_all" on public.product_likes;
create policy "product_likes_service_role_all"
on public.product_likes
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
