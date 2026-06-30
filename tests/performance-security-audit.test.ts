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
  assert.match(app, /productService\.getPublishedProductsByEventPage\(eventRow\.id, eventRow\.name/);
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
  assert.match(app, /publicEventMediaPageSize = 48/);
  assert.doesNotMatch(app, /storefrontProductLimit = 5000/);
  assert.match(app, /loadMoreLatestProducts/);
  assert.match(app, /Carregar mais eventos/);
  assert.match(app, /loadMoreEventMedia/);
  assert.match(app, /Carregar mais videos/);
  assert.match(services, /adminSnapshotLimits/);
  assert.match(services, /async getLatestProducts\(count = 20, offset = 0\)/);
  assert.match(services, /async getPublishedProductsByEventPage/);
  assert.match(services, /safePageSize = Math\.max\(1, Math\.min\(96, pageSize\)\)/);
  assert.match(services, /limit: String\(safePageSize \+ 1\)/);
  assert.match(services, /nextOffset: .*safeOffset \+ safePageSize/);
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

test('critical rate limits can use distributed Upstash Redis with memory fallback', () => {
  const security = readFileSync('server/shared/security.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');
  const checkout = readFileSync('api/checkout/create-session.ts', 'utf8');
  const confirm = readFileSync('api/checkout/confirm.ts', 'utf8');
  const webhook = readFileSync('api/webhooks/infinitepay.ts', 'utf8');
  const mediaSign = readFileSync('api/media/sign.ts', 'utf8');
  const mediaUpload = readFileSync('api/media/upload.ts', 'utf8');
  const face = readFileSync('api/face.ts', 'utf8');
  const admin = readFileSync('api/admin.ts', 'utf8');
  const system = readFileSync('api/system.ts', 'utf8');
  const downloadEmail = readFileSync('api/orders/download-email.ts', 'utf8');
  const photographerRequest = readFileSync('api/photographers/request.ts', 'utf8');
  const downloadAuthorize = readFileSync('server/api/downloads/authorize.ts', 'utf8');

  assert.match(security, /UPSTASH_REDIS_REST_URL/);
  assert.match(security, /UPSTASH_REDIS_REST_TOKEN/);
  assert.match(security, /RATE_LIMIT_REDIS_REST_URL/);
  assert.match(security, /export async function rateLimitAsync/);
  assert.match(security, /await checkDistributedRateLimit/);
  assert.match(security, /checkMemoryRateLimit\(req, options\)/);
  assert.match(security, /distributed_rate_limit_failed/);
  assert.match(security, /store: 'upstash'/);
  assert.match(server, /rateLimitAsync as sharedRateLimitAsync/);
  assert.match(server, /await sharedRateLimitAsync\(req, res, options\)/);
  assert.match(checkout, /await rateLimitAsync\(req, res, \{ keyPrefix: 'checkout'/);
  assert.match(confirm, /await rateLimitAsync\(req, res, \{ keyPrefix: 'checkout-confirm'/);
  assert.match(webhook, /await rateLimitAsync\(req, res, \{ keyPrefix: 'webhook-infinitepay'/);
  assert.match(mediaSign, /await rateLimitAsync\(req, res, \{ keyPrefix: 'media-sign'/);
  assert.match(mediaUpload, /await rateLimitAsync\(req, res, \{ keyPrefix: 'media-upload'/);
  assert.match(face, /await rateLimitAsync\(req, res, \{ keyPrefix: 'face'/);
  assert.match(admin, /await rateLimitAsync\(req, res, \{ keyPrefix: 'admin'/);
  assert.match(system, /await rateLimitAsync\(req, res, \{ keyPrefix: 'system'/);
  assert.match(downloadEmail, /await rateLimitAsync\(req, res, \{ keyPrefix: 'download-email'/);
  assert.match(photographerRequest, /await rateLimitAsync\(req, res, \{ keyPrefix: 'photographer-request'/);
  assert.match(downloadAuthorize, /await rateLimitAsync\(req, res, \{\s*keyPrefix: 'downloads'/);
});

test('backend APIs propagate request ids and write structured operational logs', () => {
  const observability = readFileSync('server/shared/observability.ts', 'utf8');
  const security = readFileSync('server/shared/security.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');
  const checkout = readFileSync('api/checkout/create-session.ts', 'utf8');
  const webhook = readFileSync('api/webhooks/infinitepay.ts', 'utf8');

  assert.match(observability, /export function ensureRequestId/);
  assert.match(observability, /res\.setHeader\(requestIdHeader, requestId\)/);
  assert.match(observability, /JSON\.stringify\(payload\)/);
  assert.match(observability, /sensitiveKeyPattern/);
  assert.match(security, /ensureRequestId\(req, res\)/);
  assert.match(security, /logEvent\('warn', 'rate_limit_exceeded'/);
  assert.match(server, /res\.on\("finish"/);
  assert.match(server, /logEvent\(res\.statusCode >= 500 \? "error" : "info", "http_request"/);
  assert.match(server, /api_unhandled_error/);
  assert.match(checkout, /ensureRequestId\(req, res, 'chk'\)/);
  assert.match(checkout, /checkout_create_session_/);
  assert.match(webhook, /ensureRequestId\(req, res, 'wh'\)/);
  assert.match(webhook, /webhook_infinitepay_failed/);
});

test('published events remain readable without exposing private events', () => {
  const sql = readFileSync('scripts/supabase-schema.sql', 'utf8');

  assert.match(sql, /create policy "events_select_published_owner_or_admin"/);
  assert.match(sql, /"isPublished" = true\s+or "photographerId" = auth\.uid\(\)::text\s+or public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /create policy "events_select_authenticated"[\s\S]*auth\.uid\(\) is not null/);
});
