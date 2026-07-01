-- Incremental media processing worker support.
-- Safe to run multiple times.

alter table public.media_processing_jobs add column if not exists attempts integer not null default 0 check (attempts >= 0);
alter table public.media_processing_jobs add column if not exists "lastStartedAt" timestamptz;
alter table public.media_processing_jobs add column if not exists "completedAt" timestamptz;

create index if not exists media_processing_jobs_pending_idx on public.media_processing_jobs ("createdAt" asc)
  where status in ('pending', 'processing');

create or replace function public.claim_media_processing_jobs(
  batch_size integer default 25,
  stale_after_minutes integer default 15
)
returns setof public.media_processing_jobs
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select j.id
    from public.media_processing_jobs j
    where (
      j.status = 'pending'
      or (
        j.status = 'processing'
        and (
          j."lastStartedAt" is null
          or j."lastStartedAt" < now() - make_interval(mins => greatest(stale_after_minutes, 1))
        )
      )
    )
    order by j."createdAt" asc
    for update skip locked
    limit least(greatest(batch_size, 1), 50)
  )
  update public.media_processing_jobs j
  set
    status = 'processing',
    attempts = j.attempts + 1,
    error = null,
    "lastStartedAt" = now(),
    "completedAt" = null
  from candidates
  where j.id = candidates.id
  returning j.*;
$$;

revoke all on function public.claim_media_processing_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_processing_jobs(integer, integer) to service_role;

create or replace function public.count_media_processing_pending()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.media_processing_jobs j
  where j.status = 'pending'
    or (
      j.status = 'processing'
      and (
        j."lastStartedAt" is null
        or j."lastStartedAt" < now() - interval '15 minutes'
      )
    );
$$;

revoke all on function public.count_media_processing_pending() from public, anon, authenticated;
grant execute on function public.count_media_processing_pending() to service_role;
