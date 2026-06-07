import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('public event page queries only products from the selected event', () => {
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const sql = readFileSync('scripts/supabase-schema.sql', 'utf8');

  assert.match(services, /async getPublishedProductsByEvent/);
  assert.match(services, /eventId: `eq\.\$\{eventId\}`/);
  assert.match(services, /event: `eq\.\$\{eventName\}`/);
  assert.match(app, /productService\.getPublishedProductsByEvent\(eventRow\.id, eventRow\.name/);
  assert.match(sql, /products_public_event_created_at_idx/);
  assert.match(sql, /products_public_vendor_event_created_at_idx/);
  assert.match(sql, /products_face_backfill_pending_idx/);
  assert.match(sql, /orders_pending_provider_created_at_idx/);
  assert.match(sql, /payments_order_provider_updated_at_idx/);
});

test('download proxy blocks private destinations and streams files', () => {
  const source = readFileSync('api/downloads/authorize.ts', 'utf8');

  assert.match(source, /isPrivateDownloadHostname/);
  assert.match(source, /value === 'localhost'/);
  assert.match(source, /parts\[0\] === 127/);
  assert.match(source, /redirect: 'manual'/);
  assert.match(source, /DOWNLOAD_SOURCE_TIMEOUT_MS/);
  assert.match(source, /Readable\.fromWeb/);
  assert.doesNotMatch(source, /upstream\.arrayBuffer\(\)/);
});

test('serverless rate limiter periodically removes expired buckets', () => {
  const source = readFileSync('api/_security.ts', 'utf8');

  assert.match(source, /cleanupRateLimitBuckets/);
  assert.match(source, /bucket\.resetAt <= now/);
  assert.match(source, /buckets\.delete\(key\)/);
});

test('published events remain readable without exposing private events', () => {
  const sql = readFileSync('scripts/supabase-schema.sql', 'utf8');

  assert.match(sql, /create policy "events_select_published_owner_or_admin"/);
  assert.match(sql, /"isPublished" = true\s+or "photographerId" = auth\.uid\(\)::text\s+or public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /create policy "events_select_authenticated"[\s\S]*auth\.uid\(\) is not null/);
});
