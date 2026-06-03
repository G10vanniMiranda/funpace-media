-- Funpace Media - Multi-photographer global face/OCR architecture
-- Idempotent patch. Apply after scripts/supabase-schema.sql.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- Keep the current products table as the sellable media contract, but add explicit
-- ownership and event references for global indexing.
alter table public.products add column if not exists "eventId" uuid references public.events(id) on delete set null;
alter table public.products add column if not exists "ownerId" text references public.photographers(id) on delete restrict;
alter table public.products add column if not exists "uploadDate" timestamptz;
alter table public.products add column if not exists "faceIndexStatus" text not null default 'pending'
  check ("faceIndexStatus" in ('pending', 'queued', 'processing', 'indexed', 'no_face', 'failed', 'disabled'));
alter table public.products add column if not exists "ocrIndexStatus" text not null default 'pending'
  check ("ocrIndexStatus" in ('pending', 'queued', 'processing', 'indexed', 'not_found', 'failed', 'disabled'));

update public.products
set
  "ownerId" = coalesce("ownerId", "vendedorId"),
  "uploadDate" = coalesce("uploadDate", "createdAt")
where "ownerId" is null or "uploadDate" is null;

create index if not exists products_event_id_idx on public.products ("eventId");
create index if not exists products_owner_id_idx on public.products ("ownerId");
create index if not exists products_upload_date_idx on public.products ("uploadDate" desc);
create index if not exists products_face_index_status_idx on public.products ("faceIndexStatus");
create index if not exists products_ocr_index_status_idx on public.products ("ocrIndexStatus");

-- Snapshot event/ownership/commission data at checkout time so later edits do not
-- rewrite financial history.
alter table public.order_items add column if not exists "eventId" uuid references public.events(id) on delete set null;
alter table public.order_items add column if not exists "ownerId" text references public.photographers(id) on delete set null;
alter table public.order_items add column if not exists "platformFeePercent" numeric(5, 2);
alter table public.order_items add column if not exists "platformFee" numeric(10, 2);
alter table public.order_items add column if not exists "photographerAmount" numeric(10, 2);

update public.order_items oi
set
  "ownerId" = coalesce(oi."ownerId", oi."vendedorId"),
  "platformFeePercent" = coalesce(oi."platformFeePercent", ps."platformFeePercent"),
  "platformFee" = coalesce(oi."platformFee", round((oi.price * ps."platformFeePercent" / 100)::numeric, 2)),
  "photographerAmount" = coalesce(oi."photographerAmount", round((oi.price - (oi.price * ps."platformFeePercent" / 100))::numeric, 2))
from public.platform_settings ps
where ps.id = 'default'
  and (oi."ownerId" is null or oi."platformFeePercent" is null or oi."platformFee" is null or oi."photographerAmount" is null);

create index if not exists order_items_event_id_idx on public.order_items ("eventId");
create index if not exists order_items_owner_id_idx on public.order_items ("ownerId");

alter table public.photographer_transactions add column if not exists "productId" uuid references public.products(id) on delete set null;
alter table public.photographer_transactions add column if not exists "eventId" uuid references public.events(id) on delete set null;
alter table public.photographer_transactions add column if not exists "platformFeePercent" numeric(5, 2);
alter table public.photographer_transactions add column if not exists currency text not null default 'BRL';
alter table public.photographer_transactions add column if not exists "availableAt" timestamptz;

create index if not exists photographer_transactions_product_id_idx on public.photographer_transactions ("productId");
create index if not exists photographer_transactions_event_id_idx on public.photographer_transactions ("eventId");
create index if not exists photographer_transactions_status_idx on public.photographer_transactions (status);

-- Central global face index. The embedding never needs to be exposed to browser
-- clients; search APIs use service role and signed media URLs.
create table if not exists public.media_face_embeddings (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete cascade,
  "photographerId" text not null references public.photographers(id) on delete cascade,
  "eventId" uuid references public.events(id) on delete set null,
  "ownerId" text not null references public.photographers(id) on delete restrict,
  "uploadDate" timestamptz not null default now(),
  "storagePath" text,
  "faceEmbedding" vector(512) not null,
  "faceBoundingBox" jsonb,
  "embeddingProvider" text not null,
  "embeddingModel" text not null,
  "qualityScore" numeric(6, 4),
  "createdAt" timestamptz not null default now(),
  unique ("productId", "embeddingProvider", "embeddingModel", "faceBoundingBox")
);

create index if not exists media_face_embeddings_product_id_idx on public.media_face_embeddings ("productId");
create index if not exists media_face_embeddings_photographer_id_idx on public.media_face_embeddings ("photographerId");
create index if not exists media_face_embeddings_event_id_idx on public.media_face_embeddings ("eventId");
create index if not exists media_face_embeddings_owner_id_idx on public.media_face_embeddings ("ownerId");
create index if not exists media_face_embeddings_upload_date_idx on public.media_face_embeddings ("uploadDate" desc);
create index if not exists media_face_embeddings_vector_idx
on public.media_face_embeddings using ivfflat ("faceEmbedding" vector_cosine_ops) with (lists = 100);

-- OCR/bib index. It supports exact lookup by number and filtered lookup by event,
-- category, date and photographer.
create table if not exists public.media_ocr_indexes (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete cascade,
  "photographerId" text not null references public.photographers(id) on delete cascade,
  "eventId" uuid references public.events(id) on delete set null,
  "ownerId" text not null references public.photographers(id) on delete restrict,
  bib text not null check (char_length(bib) <= 32),
  category text,
  "confidenceScore" numeric(6, 4),
  "boundingBox" jsonb,
  "ocrProvider" text not null,
  "ocrModel" text not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists media_ocr_indexes_bib_idx on public.media_ocr_indexes (bib);
create index if not exists media_ocr_indexes_product_id_idx on public.media_ocr_indexes ("productId");
create index if not exists media_ocr_indexes_event_id_idx on public.media_ocr_indexes ("eventId");
create index if not exists media_ocr_indexes_photographer_id_idx on public.media_ocr_indexes ("photographerId");
create index if not exists media_ocr_indexes_owner_id_idx on public.media_ocr_indexes ("ownerId");

-- Unified async queue for face/OCR indexing, backfills and retries.
create table if not exists public.media_indexing_jobs (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid references public.products(id) on delete cascade,
  "photographerId" text not null references public.photographers(id) on delete cascade,
  "eventId" uuid references public.events(id) on delete set null,
  kind text not null check (kind in ('face', 'ocr', 'thumbnail', 'watermark', 'backfill')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  priority integer not null default 100,
  attempts integer not null default 0,
  "maxAttempts" integer not null default 5,
  "runAfter" timestamptz not null default now(),
  "lockedAt" timestamptz,
  "lockedBy" text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists media_indexing_jobs_queue_idx
on public.media_indexing_jobs (status, "runAfter", priority, "createdAt");
create index if not exists media_indexing_jobs_product_kind_idx on public.media_indexing_jobs ("productId", kind);
create index if not exists media_indexing_jobs_photographer_id_idx on public.media_indexing_jobs ("photographerId");

-- Optional audit trail for customer searches. Store no raw selfie and no embedding.
create table if not exists public.face_search_queries (
  id uuid primary key default gen_random_uuid(),
  "userId" text,
  "customerEmail" text,
  "ipHash" text,
  "resultCount" integer not null default 0,
  threshold numeric(6, 4) not null,
  provider text not null,
  "processingMs" integer,
  metadata jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now()
);

create index if not exists face_search_queries_user_id_idx on public.face_search_queries ("userId");
create index if not exists face_search_queries_customer_email_idx on public.face_search_queries ("customerEmail");
create index if not exists face_search_queries_created_at_idx on public.face_search_queries ("createdAt" desc);

alter table public.media_face_embeddings enable row level security;
alter table public.media_ocr_indexes enable row level security;
alter table public.media_indexing_jobs enable row level security;
alter table public.face_search_queries enable row level security;

drop policy if exists "media_face_embeddings_admin_only" on public.media_face_embeddings;
create policy "media_face_embeddings_admin_only"
on public.media_face_embeddings
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "media_ocr_indexes_admin_only" on public.media_ocr_indexes;
create policy "media_ocr_indexes_admin_only"
on public.media_ocr_indexes
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "media_indexing_jobs_admin_only" on public.media_indexing_jobs;
create policy "media_indexing_jobs_admin_only"
on public.media_indexing_jobs
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "face_search_queries_admin_only" on public.face_search_queries;
create policy "face_search_queries_admin_only"
on public.face_search_queries
for all
using (public.is_admin())
with check (public.is_admin());
