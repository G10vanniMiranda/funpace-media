-- FunPace Media - reliable facial indexing for newly published photos.
-- Incremental and idempotent. This patch does not enqueue or process legacy photos.

alter table public.products add column if not exists "faceIndexAttempts" integer not null default 0;
alter table public.products add column if not exists "faceIndexErrorCode" text;
alter table public.products add column if not exists "faceProcessingStartedAt" timestamptz;
alter table public.products add column if not exists "faceProcessedAt" timestamptz;
alter table public.products add column if not exists "faceIndexRunId" uuid;

alter table public.photo_faces add column if not exists external_image_id text;
alter table public.photo_faces add column if not exists photographer_id text;
alter table public.photo_faces add column if not exists index_collection text;
alter table public.photo_faces add column if not exists index_model_version text;

create index if not exists photo_faces_external_image_id_idx
on public.photo_faces (external_image_id);

create or replace function public.claim_photo_face_index(
  target_photo_id uuid,
  target_event_id uuid,
  target_photographer_id text,
  stale_after_minutes integer default 15
)
returns setof public.products
language sql
security definer
set search_path = public
as $$
  update public.products p
  set
    "faceIndexStatus" = 'processing',
    "faceIndexAttempts" = coalesce(p."faceIndexAttempts", 0) + 1,
    "faceIndexError" = null,
    "faceIndexErrorCode" = null,
    "faceProcessingStartedAt" = now(),
    "faceProcessedAt" = null,
    "faceIndexRunId" = gen_random_uuid()
  where p.id = target_photo_id
    and p."eventId" = target_event_id
    and p."vendedorId" = target_photographer_id
    and p.type = 'IMG'
    and p.status = 'published'
    and (
      p."faceIndexStatus" in ('pending', 'failed')
      or (
        p."faceIndexStatus" = 'processing'
        and (
          p."faceProcessingStartedAt" is null
          or p."faceProcessingStartedAt" < now() - make_interval(mins => greatest(stale_after_minutes, 1))
        )
      )
    )
  returning p.*;
$$;

revoke all on function public.claim_photo_face_index(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_photo_face_index(uuid, uuid, text, integer) to service_role;

create or replace function public.complete_photo_face_index(
  target_photo_id uuid,
  target_event_id uuid,
  target_photographer_id text,
  target_run_id uuid,
  target_collection_id text,
  target_model_version text,
  indexed_faces jsonb
)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  face_count integer;
begin
  if jsonb_typeof(coalesce(indexed_faces, '[]'::jsonb)) <> 'array' then
    raise exception 'indexed_faces must be a JSON array';
  end if;

  perform 1
  from public.products p
  where p.id = target_photo_id
    and p."eventId" = target_event_id
    and p."vendedorId" = target_photographer_id
    and p."faceIndexStatus" = 'processing'
    and p."faceIndexRunId" = target_run_id
  for update;

  if not found then
    return;
  end if;

  delete from public.photo_faces where photo_id = target_photo_id;

  insert into public.photo_faces (
    face_id,
    image_id,
    event_id,
    photo_id,
    confidence,
    external_image_id,
    photographer_id,
    index_collection,
    index_model_version
  )
  select
    face.face_id,
    face.image_id,
    target_event_id,
    target_photo_id,
    face.confidence,
    target_photo_id::text,
    target_photographer_id,
    target_collection_id,
    target_model_version
  from jsonb_to_recordset(coalesce(indexed_faces, '[]'::jsonb))
    as face(face_id text, image_id text, confidence numeric)
  where nullif(face.face_id, '') is not null
  on conflict (face_id) do update
  set
    image_id = excluded.image_id,
    event_id = excluded.event_id,
    photo_id = excluded.photo_id,
    confidence = excluded.confidence,
    external_image_id = excluded.external_image_id,
    photographer_id = excluded.photographer_id,
    index_collection = excluded.index_collection,
    index_model_version = excluded.index_model_version;

  select count(*) into face_count
  from public.photo_faces
  where photo_id = target_photo_id
    and event_id = target_event_id
    and external_image_id = target_photo_id::text;

  return query
  update public.products p
  set
    "faceIndexStatus" = case when face_count > 0 then 'indexed' else 'no_face' end,
    "faceIndexError" = null,
    "faceIndexErrorCode" = null,
    "faceIndexedAt" = case when face_count > 0 then now() else null end,
    "faceProcessingStartedAt" = null,
    "faceProcessedAt" = now(),
    "faceIndexRunId" = null
  where p.id = target_photo_id
    and p."faceIndexRunId" = target_run_id
  returning p.*;
end;
$$;

revoke all on function public.complete_photo_face_index(uuid, uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_photo_face_index(uuid, uuid, text, uuid, text, text, jsonb) to service_role;

create or replace function public.fail_photo_face_index(
  target_photo_id uuid,
  target_run_id uuid,
  target_error_code text,
  target_error_message text
)
returns setof public.products
language sql
security definer
set search_path = public
as $$
  update public.products p
  set
    "faceIndexStatus" = 'failed',
    "faceIndexError" = left(coalesce(target_error_message, 'Falha na indexacao facial.'), 1000),
    "faceIndexErrorCode" = left(coalesce(target_error_code, 'FaceIndexError'), 120),
    "faceProcessingStartedAt" = null,
    "faceProcessedAt" = now(),
    "faceIndexRunId" = null
  where p.id = target_photo_id
    and p."faceIndexStatus" = 'processing'
    and p."faceIndexRunId" = target_run_id
  returning p.*;
$$;

revoke all on function public.fail_photo_face_index(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_photo_face_index(uuid, uuid, text, text) to service_role;

