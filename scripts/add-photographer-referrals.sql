alter table public.photographers add column if not exists "referralCode" text;
alter table public.photographers add column if not exists "referredByPhotographerId" text references public.photographers(id) on delete set null;

create unique index if not exists photographers_referral_code_key
on public.photographers ("referralCode")
where "referralCode" is not null;

create index if not exists photographers_referred_by_idx
on public.photographers ("referredByPhotographerId");

update public.photographers
set "referralCode" = coalesce(
  nullif("referralCode", ''),
  nullif(username, ''),
  nullif(slug, ''),
  'fp-' || substr(md5(id), 1, 10)
)
where "referralCode" is null;

create table if not exists public.photographer_referrals (
  id uuid primary key default gen_random_uuid(),
  "referrerPhotographerId" text not null references public.photographers(id) on update cascade on delete cascade,
  "referredPhotographerId" text not null references public.photographers(id) on update cascade on delete cascade,
  "referralCode" text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'active', 'rewarded', 'canceled')),
  "createdAt" timestamptz not null default now(),
  "approvedAt" timestamptz,
  "firstSaleAt" timestamptz,
  "rewardAmount" numeric(12, 2) not null default 0 check ("rewardAmount" >= 0),
  "rewardStatus" text not null default 'none' check ("rewardStatus" in ('none', 'pending', 'available', 'paid', 'canceled')),
  "paidAt" timestamptz,
  "canceledAt" timestamptz,
  audit jsonb not null default '{}'::jsonb,
  constraint photographer_referrals_no_self_referral check ("referrerPhotographerId" <> "referredPhotographerId")
);

create unique index if not exists photographer_referrals_referred_key
on public.photographer_referrals ("referredPhotographerId");

create index if not exists photographer_referrals_referrer_status_idx
on public.photographer_referrals ("referrerPhotographerId", status, "createdAt" desc);

alter table public.platform_settings add column if not exists "referralSettings" jsonb not null default jsonb_build_object(
  'enabled', true,
  'rewardRuleType', 'first_sale_fixed',
  'approvalRewardAmount', 50,
  'firstSaleRewardAmount', 100,
  'recurringCommissionPercent', 5,
  'recurringCommissionMonths', 3
);

update public.platform_settings
set "referralSettings" = coalesce("referralSettings", '{}'::jsonb) || jsonb_build_object(
  'enabled', coalesce(("referralSettings" ->> 'enabled')::boolean, true),
  'rewardRuleType', coalesce("referralSettings" ->> 'rewardRuleType', 'first_sale_fixed'),
  'approvalRewardAmount', coalesce(("referralSettings" ->> 'approvalRewardAmount')::numeric, 50),
  'firstSaleRewardAmount', coalesce(("referralSettings" ->> 'firstSaleRewardAmount')::numeric, 100),
  'recurringCommissionPercent', coalesce(("referralSettings" ->> 'recurringCommissionPercent')::numeric, 5),
  'recurringCommissionMonths', coalesce(("referralSettings" ->> 'recurringCommissionMonths')::int, 3)
)
where id = 'default';

alter table public.photographer_referrals enable row level security;

drop policy if exists "photographer_referrals_select_owner_or_admin" on public.photographer_referrals;
create policy "photographer_referrals_select_owner_or_admin"
on public.photographer_referrals
for select
using (
  public.is_admin()
  or "referrerPhotographerId" = auth.uid()::text
  or "referredPhotographerId" = auth.uid()::text
);

drop policy if exists "photographer_referrals_admin_all" on public.photographer_referrals;
create policy "photographer_referrals_admin_all"
on public.photographer_referrals
for all
using (public.is_admin())
with check (public.is_admin());
