begin;

create or replace function public.enforce_new_product_face_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_photographer text;
begin
  if new.type <> 'IMG' or new.status = 'removed' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.type is not distinct from old.type
     and new."eventId" is not distinct from old."eventId"
     and new."vendedorId" is not distinct from old."vendedorId"
     and new."faceIndexStatus" is not distinct from old."faceIndexStatus" then
    return new;
  end if;

  if new."eventId" is null then
    raise exception using errcode = '23514', message = 'face_integrity:event_id_required';
  end if;

  select e."photographerId" into event_photographer
  from public.events e
  where e.id = new."eventId";

  if event_photographer is null then
    raise exception using errcode = '23503', message = 'face_integrity:event_invalid';
  end if;

  if new."vendedorId" is distinct from event_photographer then
    raise exception using errcode = '23514', message = 'face_integrity:photographer_mismatch';
  end if;

  if new."faceIndexStatus" = 'indexed' and not exists (
    select 1 from public.photo_faces f
    where f.photo_id = new.id
      and f.event_id = new."eventId"
      and f.photographer_id = new."vendedorId"
  ) then
    raise exception using errcode = '23514', message = 'face_integrity:indexed_without_photo_faces';
  end if;

  if new."faceIndexStatus" = 'no_face' and exists (
    select 1 from public.photo_faces f where f.photo_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'face_integrity:no_face_with_photo_faces';
  end if;

  return new;
end;
$$;

drop trigger if exists products_face_integrity_guard on public.products;
create trigger products_face_integrity_guard
before insert or update of type, "eventId", "vendedorId", "faceIndexStatus"
on public.products
for each row execute function public.enforce_new_product_face_integrity();

create or replace function public.enforce_photo_face_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_event uuid;
  product_photographer text;
  event_photographer text;
  product_type text;
begin
  select p."eventId", p."vendedorId", p.type, e."photographerId"
    into product_event, product_photographer, product_type, event_photographer
  from public.products p
  left join public.events e on e.id = p."eventId"
  where p.id = new.photo_id;

  if not found or product_type <> 'IMG' then
    raise exception using errcode = '23503', message = 'face_integrity:photo_product_invalid';
  end if;
  if product_event is null or new.event_id is distinct from product_event then
    raise exception using errcode = '23514', message = 'face_integrity:face_event_mismatch';
  end if;
  if product_photographer is null or new.photographer_id is distinct from product_photographer then
    raise exception using errcode = '23514', message = 'face_integrity:face_photographer_mismatch';
  end if;
  if event_photographer is null or product_photographer is distinct from event_photographer then
    raise exception using errcode = '23514', message = 'face_integrity:product_event_photographer_mismatch';
  end if;
  if new.external_image_id is distinct from new.photo_id::text then
    raise exception using errcode = '23514', message = 'face_integrity:external_image_id_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists photo_faces_integrity_guard on public.photo_faces;
create trigger photo_faces_integrity_guard
before insert or update of photo_id, event_id, photographer_id, external_image_id
on public.photo_faces
for each row execute function public.enforce_photo_face_integrity();

create or replace function public.prevent_indexed_photo_face_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.products p
    where p.id = old.photo_id and p."faceIndexStatus" = 'indexed'
  ) then
    raise exception using errcode = '23514', message = 'face_integrity:cannot_remove_face_from_indexed_photo';
  end if;
  return old;
end;
$$;

drop trigger if exists photo_faces_delete_integrity_guard on public.photo_faces;
create trigger photo_faces_delete_integrity_guard
before delete on public.photo_faces
for each row execute function public.prevent_indexed_photo_face_removal();

revoke all on function public.enforce_new_product_face_integrity() from public, anon, authenticated;
revoke all on function public.enforce_photo_face_integrity() from public, anon, authenticated;
revoke all on function public.prevent_indexed_photo_face_removal() from public, anon, authenticated;

insert into public.integrity_alert_rules(metric_name, operator, threshold, severity, cooldown_minutes, channels)
values
  ('face_processing', 'gt', 25, 'warning', 15, '["log"]'),
  ('indexed_without_faces', 'gt', 0, 'critical', 30, '["log"]'),
  ('invalid_product_events', 'gt', 0, 'critical', 30, '["log"]'),
  ('face_event_mismatches', 'gt', 0, 'critical', 30, '["log"]'),
  ('face_photographer_invalid', 'gt', 0, 'warning', 60, '["log"]'),
  ('duplicate_database_face_ids', 'gt', 0, 'critical', 30, '["log"]'),
  ('duplicate_aws_face_ids', 'gt', 0, 'critical', 30, '["log"]')
on conflict (metric_name) do update set
  operator = excluded.operator,
  threshold = excluded.threshold,
  severity = excluded.severity,
  cooldown_minutes = excluded.cooldown_minutes,
  channels = excluded.channels,
  updated_at = now();

commit;
