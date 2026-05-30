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
