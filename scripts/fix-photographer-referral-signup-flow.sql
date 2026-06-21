alter table public.photographers add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.photographers add column if not exists approved boolean not null default false;
alter table public.photographers add column if not exists status text not null default 'pending';
alter table public.photographers add column if not exists referral_id uuid;
alter table public.photographers add column if not exists invited_by text;

do $$
begin
  alter table public.photographers drop constraint if exists photographers_status_check;
  alter table public.photographers add constraint photographers_status_check
    check (status in ('pending', 'active', 'disabled'));
end $$;

create unique index if not exists photographers_auth_user_id_key
on public.photographers (auth_user_id)
where auth_user_id is not null;

create index if not exists photographers_auth_user_id_idx
on public.photographers (auth_user_id);

update public.photographers p
set
  auth_user_id = u.id,
  id = case when p.id like 'pending:%' then u.id::text else p.id end,
  approved = p.verified,
  status = case
    when p."blockedAt" is not null then 'disabled'
    when p.verified = true then 'active'
    else 'pending'
  end,
  "isPublic" = case when p.verified = true then p."isPublic" else false end,
  "updatedAt" = now()
from auth.users u
where lower(u.email) = lower(p.email)
  and (p.auth_user_id is null or p.id like 'pending:%');

insert into public.photographers (
  id,
  auth_user_id,
  name,
  "displayName",
  email,
  bio,
  avatar,
  "isPublic",
  verified,
  approved,
  status,
  stats,
  "createdAt",
  "updatedAt"
)
select
  u.id::text,
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
  coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
  lower(u.email),
  '',
  '',
  false,
  false,
  false,
  'pending',
  jsonb_build_object(
    'photos', 0,
    'events', 0,
    'rating', 5,
    'totalEarnings', 0,
    'pendingEarnings', 0,
    'salesCount', 0
  ),
  coalesce(u.created_at, now()),
  now()
from auth.users u
where u.email is not null
  and coalesce(u.raw_user_meta_data ->> 'instagram', '') <> ''
  and not exists (
    select 1
    from public.photographers p
    where p.auth_user_id = u.id
       or lower(p.email) = lower(u.email)
  );

update public.photographers p
set
  "referredByPhotographerId" = r."referrerPhotographerId",
  referral_id = r.id,
  invited_by = r."referrerPhotographerId",
  "updatedAt" = now()
from public.photographer_referrals r
where r."referredPhotographerId" = p.id
  and (
    p."referredByPhotographerId" is distinct from r."referrerPhotographerId"
    or p.referral_id is distinct from r.id
    or p.invited_by is distinct from r."referrerPhotographerId"
  );

drop policy if exists "photographers_select_public_verified_or_owner_or_admin" on public.photographers;
create policy "photographers_select_public_verified_or_owner_or_admin"
on public.photographers
for select
using (
  (verified = true and "isPublic" = true)
  or id = auth.uid()::text
  or auth_user_id = auth.uid()
  or public.is_admin()
);
