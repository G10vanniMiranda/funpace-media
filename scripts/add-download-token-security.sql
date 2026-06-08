begin;

create table if not exists public.download_tokens (
  id uuid primary key default gen_random_uuid(),
  "tokenHash" text not null unique,
  "orderId" uuid not null references public.orders(id) on delete cascade,
  "orderItemId" uuid not null references public.order_items(id) on delete cascade,
  "userId" text,
  email text,
  "expiresAt" timestamptz not null,
  "consumedAt" timestamptz,
  "createdAt" timestamptz not null default now()
);

create index if not exists download_tokens_order_item_idx on public.download_tokens ("orderId", "orderItemId");
create index if not exists download_tokens_expires_at_idx on public.download_tokens ("expiresAt");
create index if not exists download_tokens_consumed_at_idx on public.download_tokens ("consumedAt");

alter table public.download_tokens enable row level security;

drop policy if exists "download_tokens_service_role_all" on public.download_tokens;
create policy "download_tokens_service_role_all"
on public.download_tokens
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

revoke all on table public.download_tokens from anon, authenticated;

commit;
