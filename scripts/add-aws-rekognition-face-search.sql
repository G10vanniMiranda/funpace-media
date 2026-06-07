-- Funpace Media - AWS Rekognition face search
-- Incremental and idempotent. Apply after scripts/supabase-schema.sql.

alter table public.products add column if not exists "eventId" uuid references public.events(id) on delete set null;
alter table public.products add column if not exists "faceIndexStatus" text not null default 'pending';
alter table public.products add column if not exists "faceIndexError" text;
alter table public.products add column if not exists "faceIndexedAt" timestamptz;

do $$
begin
  alter table public.products drop constraint if exists products_face_index_status_check;
  alter table public.products add constraint products_face_index_status_check
    check ("faceIndexStatus" in ('pending', 'processing', 'indexed', 'no_face', 'failed', 'disabled'));
end $$;

create index if not exists products_event_id_idx on public.products ("eventId");
create index if not exists products_face_index_status_idx on public.products ("faceIndexStatus");

create table if not exists public.photo_faces (
  id uuid primary key default gen_random_uuid(),
  face_id text not null unique,
  image_id text,
  event_id uuid not null references public.events(id) on delete cascade,
  photo_id uuid not null references public.products(id) on delete cascade,
  confidence numeric(7, 4),
  created_at timestamptz not null default now()
);

create index if not exists photo_faces_event_id_idx on public.photo_faces (event_id);
create index if not exists photo_faces_photo_id_idx on public.photo_faces (photo_id);
create index if not exists photo_faces_event_face_id_idx on public.photo_faces (event_id, face_id);
create unique index if not exists photo_faces_photo_face_unique_idx
on public.photo_faces (photo_id, face_id);

alter table public.photo_faces enable row level security;

drop policy if exists "photo_faces_admin_only" on public.photo_faces;
create policy "photo_faces_admin_only"
on public.photo_faces
for all
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.photo_faces from anon, authenticated;
