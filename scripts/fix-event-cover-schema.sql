create extension if not exists pgcrypto;

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
  "coverMediaId" uuid references public.products(id) on delete set null,
  "bannerImage" text,
  cover_position text not null default 'center center',
  "isPublished" boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'closed')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.events add column if not exists "photographerId" text references public.photographers(id) on delete cascade;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists location text;
alter table public.events add column if not exists checkpoint text;
alter table public.events add column if not exists "coverImage" text;
alter table public.events add column if not exists "coverMediaId" uuid references public.products(id) on delete set null;
alter table public.events add column if not exists "bannerImage" text;
alter table public.events add column if not exists cover_position text not null default 'center center';
alter table public.events add column if not exists "isPublished" boolean not null default true;
alter table public.events add column if not exists "isFeatured" boolean not null default false;
alter table public.events add column if not exists "moderationStatus" text not null default 'approved';
alter table public.events add column if not exists "updatedAt" timestamptz not null default now();

create index if not exists events_photographer_id_idx on public.events ("photographerId");
create index if not exists events_cover_media_id_idx on public.events ("coverMediaId");

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  true,
  15728640,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photographer_profile_images_public_select" on storage.objects;
create policy "photographer_profile_images_public_select"
on storage.objects
for select
using (bucket_id in ('photographer-avatars', 'photographer-covers'));

drop policy if exists "event_covers_public_select" on storage.objects;
create policy "event_covers_public_select"
on storage.objects
for select
using (bucket_id = 'event-covers');

drop policy if exists "event_covers_insert_own_folder" on storage.objects;
create policy "event_covers_insert_own_folder"
on storage.objects
for insert
with check (
  bucket_id = 'event-covers'
  and (
    public.is_admin()
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = 'covers'
      and (storage.foldername(name))[2] = auth.uid()::text
      and public.is_verified_photographer()
    )
  )
);

drop policy if exists "event_covers_update_own_folder" on storage.objects;
create policy "event_covers_update_own_folder"
on storage.objects
for update
using (
  bucket_id = 'event-covers'
  and (
    public.is_admin()
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = 'covers'
      and (storage.foldername(name))[2] = auth.uid()::text
      and public.is_verified_photographer()
    )
  )
)
with check (
  bucket_id = 'event-covers'
  and (
    public.is_admin()
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = 'covers'
      and (storage.foldername(name))[2] = auth.uid()::text
      and public.is_verified_photographer()
    )
  )
);

drop policy if exists "event_covers_delete_own_folder" on storage.objects;
create policy "event_covers_delete_own_folder"
on storage.objects
for delete
using (
  bucket_id = 'event-covers'
  and (
    public.is_admin()
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = 'covers'
      and (storage.foldername(name))[2] = auth.uid()::text
      and public.is_verified_photographer()
    )
  )
);

alter table public.events enable row level security;

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

notify pgrst, 'reload schema';
