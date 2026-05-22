drop policy if exists "orders_select_owner_email_or_admin" on public.orders;

create policy "orders_select_owner_email_or_admin"
on public.orders
for select
using (
  public.is_admin()
  or ("userId" is not null and "userId" = auth.uid()::text)
  or ("buyerEmail" = (auth.jwt() ->> 'email'))
);
