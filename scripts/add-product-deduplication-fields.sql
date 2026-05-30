alter table public.products
  add column if not exists "fileHash" text,
  add column if not exists "fileSize" bigint,
  add column if not exists "originalFileName" text,
  add column if not exists "thumbnailHash" text,
  add column if not exists "uploadBatchId" text;

create index if not exists products_file_hash_vendedor_idx
on public.products ("vendedorId", "fileHash")
where "fileHash" is not null and coalesce(status, 'published') <> 'removed';

create index if not exists products_upload_batch_idx
on public.products ("uploadBatchId")
where "uploadBatchId" is not null;
