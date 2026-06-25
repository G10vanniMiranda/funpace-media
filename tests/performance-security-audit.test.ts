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

test('storefront and admin snapshot use bounded server-side result windows', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const snapshot = readFileSync('server/api/admin/snapshot.ts', 'utf8');
  const adminDashboard = readFileSync('src/components/AdminDashboard.tsx', 'utf8');

  assert.match(app, /storefrontInitialProductLimit = 600/);
  assert.match(app, /storefrontScopedProductLimit = 1200/);
  assert.doesNotMatch(app, /storefrontProductLimit = 5000/);
  assert.match(app, /loadMoreLatestProducts/);
  assert.match(app, /Carregar mais eventos/);
  assert.match(services, /adminSnapshotLimits/);
  assert.match(services, /async getLatestProducts\(count = 20, offset = 0\)/);
  assert.match(services, /offset: String\(Math\.max\(0, offset\)\)/);
  assert.match(services, /\/api\/admin\/snapshot\?\$\{snapshotParams\.toString\(\)\}/);
  assert.match(snapshot, /readLimit/);
  assert.match(snapshot, /fetchOrderItemsForOrders/);
  assert.doesNotMatch(snapshot, /order_items\?select=\*&order=createdAt\.asc&limit=20000/);
  assert.doesNotMatch(snapshot, /products\?select=\*&order=createdAt\.desc&limit=10000/);
  assert.match(adminDashboard, /adminListPageSizes/);
  assert.match(adminDashboard, /visibleAdminRows/);
  assert.match(adminDashboard, /AdminLoadMoreButton/);
  assert.match(adminDashboard, /showMoreAdminRows/);
  assert.match(adminDashboard, /filteredPhotographers\.slice\(0, visibleAdminRows\.photographers\)/);
  assert.match(adminDashboard, /filteredMedia\.slice\(0, visibleAdminRows\.media\)/);
  assert.match(adminDashboard, /filteredOrders\.slice\(0, visibleAdminRows\.orders\)/);
  assert.match(adminDashboard, /filteredLogs\.slice\(0, visibleAdminRows\.logs\)/);
  assert.match(adminDashboard, /visiblePaymentIssues\.slice\(0, visibleAdminRows\.paymentIssues\)/);
});

test('download proxy blocks private destinations and streams files', () => {
  const source = readFileSync('server/api/downloads/authorize.ts', 'utf8');

  assert.match(source, /isPrivateDownloadHostname/);
  assert.match(source, /value === 'localhost'/);
  assert.match(source, /parts\[0\] === 127/);
  assert.match(source, /redirect: 'manual'/);
  assert.match(source, /DOWNLOAD_SOURCE_TIMEOUT_MS/);
  assert.match(source, /Readable\.fromWeb/);
  assert.doesNotMatch(source, /upstream\.arrayBuffer\(\)/);
});

test('serverless rate limiter periodically removes expired buckets', () => {
  const source = readFileSync('server/shared/security.ts', 'utf8');

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
