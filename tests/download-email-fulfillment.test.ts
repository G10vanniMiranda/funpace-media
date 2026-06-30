import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('paid order fulfillment sends audited download email without blocking release', () => {
  const fulfillment = readFileSync('server/shared/checkoutFulfillment.ts', 'utf8');
  const template = readFileSync('server/shared/emailTemplates.ts', 'utf8');

  assert.match(fulfillment, /export async function fulfillPaidOrder/);
  assert.match(fulfillment, /await releaseDownloadAccess\(orderId\)/);
  assert.match(fulfillment, /await registerPhotographerTransactions\(orderId\)/);
  assert.match(fulfillment, /await sendPaidOrderEmailOnce\(orderId\)/);
  assert.match(fulfillment, /RESEND_API_KEY/);
  assert.match(fulfillment, /EMAIL_FROM/);
  assert.match(fulfillment, /FRONTEND_URL/);
  assert.match(fulfillment, /\/rest\/v1\/email_logs/);
  assert.match(fulfillment, /status: 'failed'/);
  assert.match(template, /Acessar minhas fotos/);
  assert.match(template, /Baixar arquivos/);
  assert.match(template, /nao contem URL publica permanente/);
});

test('webhook and checkout confirmation run shared paid fulfillment', () => {
  const fulfillment = readFileSync('server/shared/checkoutFulfillment.ts', 'utf8');
  const webhook = readFileSync('api/webhooks/infinitepay.ts', 'utf8');
  const confirm = readFileSync('api/checkout/confirm.ts', 'utf8');
  const createSession = readFileSync('api/checkout/create-session.ts', 'utf8');

  assert.match(webhook, /import \{ fulfillPaidOrder, recordPayment \}/);
  assert.match(webhook, /await fulfillPaidOrder\(orderId\)/);
  assert.match(confirm, /import \{ fulfillPaidOrder, recordPayment \}/);
  assert.match(confirm, /await fulfillPaidOrder\(orderId\)/);
  assert.match(createSession, /import \{ recordPayment \}/);
  assert.doesNotMatch(confirm, /function setCors/);
  assert.doesNotMatch(confirm, /function releaseDownloadAccess/);
  assert.doesNotMatch(confirm, /function recordPayment\(input/);
  assert.doesNotMatch(createSession, /function recordPayment\(input/);
  assert.doesNotMatch(webhook, /function setCors/);
  assert.doesNotMatch(webhook, /function releaseDownloadAccess/);
  assert.doesNotMatch(webhook, /function recordPayment\(input/);
  assert.doesNotMatch(confirm, /photographer_transactions\?on_conflict=orderItemId/);
  assert.doesNotMatch(confirm, /download_access\?on_conflict=orderId,photoId/);
  assert.doesNotMatch(webhook, /photographer_transactions\?on_conflict=orderItemId/);
  assert.doesNotMatch(webhook, /download_access\?on_conflict=orderId,photoId/);
  assert.match(fulfillment, /payments\?orderId=eq/);
});

test('paid fulfillment adjusts product sales counts atomically in Postgres', () => {
  const fulfillment = readFileSync('server/shared/checkoutFulfillment.ts', 'utf8');
  const adminStatus = readFileSync('server/api/admin/orders/status.ts', 'utf8');
  const reconcile = readFileSync('scripts/reconcile-infinitepay-pending-orders.mjs', 'utf8');
  const sql = readFileSync('scripts/supabase-schema.sql', 'utf8');

  assert.match(sql, /create or replace function public\.adjust_product_sales_counts/);
  assert.match(sql, /update public\.products p/);
  assert.match(sql, /"salesCount" = greatest\(0, coalesce\(p\."salesCount", 0\) \+ counted\.quantity \* delta\)/);
  assert.match(sql, /grant execute on function public\.adjust_product_sales_counts\(uuid\[\], integer\) to service_role/);
  assert.match(fulfillment, /export async function adjustProductSalesCounts/);
  assert.match(fulfillment, /\/rest\/v1\/rpc\/adjust_product_sales_counts/);
  assert.match(fulfillment, /await adjustProductSalesCounts\(newItems\.map\(\(item\) => item\.productId\), 1\)/);
  assert.match(adminStatus, /adjustProductSalesCounts\(items\.map\(\(item\) => item\.productId\), -1\)/);
  assert.match(reconcile, /\/rest\/v1\/rpc\/adjust_product_sales_counts/);
  assert.doesNotMatch(fulfillment, /select=salesCount/);
  assert.doesNotMatch(adminStatus, /select=salesCount/);
  assert.doesNotMatch(reconcile, /select=salesCount/);
});

test('manual resend endpoint validates owner or admin before forcing resend', () => {
  const endpoint = readFileSync('api/orders/download-email.ts', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(endpoint, /getAuthenticatedUser/);
  assert.match(endpoint, /role === 'admin'/);
  assert.match(endpoint, /order\.userId === authUser\.id/);
  assert.match(endpoint, /buyerEmail === authUser\.email/);
  assert.match(endpoint, /status !== 'paid'/);
  assert.match(endpoint, /sendPaidOrderEmail\(orderId, \{\s*force: true/);
  assert.match(services, /resendDownloadEmail/);
  assert.match(services, /\/api\/orders\/download-email/);
});

test('schema includes email audit logs and token-backed downloads', () => {
  const sql = readFileSync('scripts/supabase-schema.sql', 'utf8');
  const downloads = readFileSync('server/api/downloads/authorize.ts', 'utf8');

  assert.match(sql, /create table if not exists public\.email_logs/);
  assert.match(sql, /order_id uuid references public\.orders/);
  assert.match(sql, /status text not null check \(status in \('sent', 'failed', 'skipped'\)\)/);
  assert.match(sql, /email_logs_admin_select/);
  assert.match(sql, /create table if not exists public\.download_tokens/);
  assert.match(sql, /download_tokens_service_role_all/);
  assert.match(downloads, /signDownloadPayload/);
  assert.match(downloads, /DOWNLOAD_LINK_TTL_SECONDS/);
  assert.match(downloads, /consumeDownloadToken/);
  assert.match(downloads, /order\.status !== 'paid'/);
  assert.match(downloads, /belongsToUser/);
});
