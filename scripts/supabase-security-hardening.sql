-- Supabase Security Advisor hardening.
-- Execute in the Supabase SQL editor after reviewing production access needs.

begin;

-- Functions with mutable search_path.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;

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

create or replace function public.order_has_vendor(order_id uuid, vendor_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_items oi
    where oi."orderId" = order_id
      and oi."vendedorId" = vendor_id
  )
$$;

revoke all on function public.order_has_vendor(uuid, text) from public;
grant execute on function public.order_has_vendor(uuid, text) to authenticated;
grant execute on function public.order_has_vendor(uuid, text) to service_role;

-- Remove permissive legacy policies commonly created during early setup/tests.
drop policy if exists "Enable read access for all users" on public.photographers;
drop policy if exists "Enable read access for all users" on public.customers;
drop policy if exists "Enable read access for all users" on public.products;
drop policy if exists "Enable read access for all users" on public.events;
drop policy if exists "Enable read access for all users" on public.orders;
drop policy if exists "Enable read access for all users" on public.order_items;
drop policy if exists "Enable read access for all users" on public.payment_events;
drop policy if exists "Enable read access for all users" on public.download_events;
drop policy if exists "Enable read access for all users" on public.withdrawal_requests;
drop policy if exists "Enable read access for all users" on public.platform_settings;

drop policy if exists "Enable insert for authenticated users only" on public.photographers;
drop policy if exists "Enable insert for authenticated users only" on public.customers;
drop policy if exists "Enable insert for authenticated users only" on public.products;
drop policy if exists "Enable insert for authenticated users only" on public.events;
drop policy if exists "Enable insert for authenticated users only" on public.orders;
drop policy if exists "Enable insert for authenticated users only" on public.order_items;
drop policy if exists "Enable insert for authenticated users only" on public.payment_events;
drop policy if exists "Enable insert for authenticated users only" on public.download_events;
drop policy if exists "Enable insert for authenticated users only" on public.withdrawal_requests;
drop policy if exists "Enable insert for authenticated users only" on public.platform_settings;

drop policy if exists "Enable update for users based on email" on public.photographers;
drop policy if exists "Enable update for users based on email" on public.customers;
drop policy if exists "Enable update for authenticated users only" on public.products;
drop policy if exists "Enable update for authenticated users only" on public.events;
drop policy if exists "Enable update for authenticated users only" on public.orders;
drop policy if exists "Enable update for authenticated users only" on public.order_items;
drop policy if exists "Enable update for authenticated users only" on public.payment_events;
drop policy if exists "Enable update for authenticated users only" on public.download_events;
drop policy if exists "Enable update for authenticated users only" on public.withdrawal_requests;
drop policy if exists "Enable update for authenticated users only" on public.platform_settings;

drop policy if exists "Enable delete for authenticated users only" on public.photographers;
drop policy if exists "Enable delete for authenticated users only" on public.customers;
drop policy if exists "Enable delete for authenticated users only" on public.products;
drop policy if exists "Enable delete for authenticated users only" on public.events;
drop policy if exists "Enable delete for authenticated users only" on public.orders;
drop policy if exists "Enable delete for authenticated users only" on public.order_items;
drop policy if exists "Enable delete for authenticated users only" on public.payment_events;
drop policy if exists "Enable delete for authenticated users only" on public.download_events;
drop policy if exists "Enable delete for authenticated users only" on public.withdrawal_requests;
drop policy if exists "Enable delete for authenticated users only" on public.platform_settings;

-- Recreate least-privilege policies from the application schema.
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

drop policy if exists "events_select_authenticated" on public.events;
create policy "events_select_authenticated"
on public.events
for select
using (auth.uid() is not null);

drop policy if exists "events_insert_admin_only" on public.events;
create policy "events_insert_admin_only"
on public.events
for insert
with check (public.is_admin());

drop policy if exists "events_update_admin_only" on public.events;
create policy "events_update_admin_only"
on public.events
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "events_delete_admin_only" on public.events;
create policy "events_delete_admin_only"
on public.events
for delete
using (public.is_admin());

drop policy if exists "orders_select_owner_email_or_admin" on public.orders;
create policy "orders_select_owner_email_or_admin"
on public.orders
for select
using (
  public.is_admin()
  or ("userId" is not null and "userId" = auth.uid()::text)
  or ("buyerEmail" = (auth.jwt() ->> 'email'))
  or public.order_has_vendor(id, auth.uid()::text)
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

-- Smoke-test table should not expose permissive public policies.
alter table if exists public.codex_connection_test enable row level security;
drop policy if exists "Enable read access for all users" on public.codex_connection_test;
drop policy if exists "Enable insert for authenticated users only" on public.codex_connection_test;
drop policy if exists "codex_connection_test_allow_all" on public.codex_connection_test;
drop policy if exists "codex_connection_test_admin_only" on public.codex_connection_test;
create policy "codex_connection_test_admin_only"
on public.codex_connection_test
for all
using (public.is_admin())
with check (public.is_admin());

-- SECURITY DEFINER helper functions should not be executable by API roles unless explicitly needed.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
    revoke all on function public.rls_auto_enable() from anon;
    revoke all on function public.rls_auto_enable() from authenticated;
  end if;
end $$;

commit;
