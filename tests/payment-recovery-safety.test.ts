import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production CSP allows the configured API host used by admin recovery calls', () => {
  const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const csp = vercelConfig.headers
    .flatMap((entry: any) => entry.headers)
    .find((header: any) => header.key === 'Content-Security-Policy')?.value || '';

  assert.match(csp, /connect-src[^;]*https:\/\/api\.funpace\.media/);
});

test('admin payment recovery uses stable rewritten API paths', () => {
  const services = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(services, /apiUrl\('\/api\/admin\/payments\/recovery'\)/);
  assert.match(services, /apiUrl\('\/api\/admin\/orders\/status'\)/);
  assert.doesNotMatch(services, /apiUrl\('\/api\/admin\?route=payments-recovery'\)/);
  assert.doesNotMatch(services, /apiUrl\('\/api\/admin\?route=orders-status'\)/);
});

test('InfinitePay webhook records incomplete paid payloads for recovery instead of rejecting them', () => {
  const webhook = readFileSync('api/webhooks/infinitepay.ts', 'utf8');

  assert.match(webhook, /webhook_warning: 'missing_transaction_or_slug'/);
  assert.match(webhook, /requires_admin_recovery: payloadStatus === 'paid'/);
  assert.match(webhook, /res\.status\(202\)\.json/);
  assert.doesNotMatch(webhook, /Webhook sem transaction_nsu ou invoice_slug\.',\s*\}\);\s*return res\.status\(400\)/);
});
