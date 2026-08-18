import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMaintenanceHtml,
  getMaintenanceRetryAfter,
  isMaintenanceModeEnabled,
  shouldServeMaintenancePage,
} from '../server/shared/maintenance';
import { readFileSync } from 'node:fs';

test('maintenance flag accepts explicit enabled values and defaults to off', () => {
  assert.equal(isMaintenanceModeEnabled('true'), true);
  assert.equal(isMaintenanceModeEnabled('ON'), true);
  assert.equal(isMaintenanceModeEnabled('false'), false);
  assert.equal(isMaintenanceModeEnabled(''), false);
});

test('maintenance mode intercepts public routes only', () => {
  const maintenance = (pathname: string, method = 'GET') => shouldServeMaintenancePage({
    pathname,
    method,
    maintenanceMode: 'true',
  });

  assert.equal(maintenance('/'), true);
  assert.equal(maintenance('/eventos/corrida-2026'), true);
  assert.equal(maintenance('/fotografo/perfil-publico'), true);
  assert.equal(maintenance('/precos'), true);
  assert.equal(maintenance('/api/health'), false);
  assert.equal(maintenance('/api/webhooks/infinitepay', 'POST'), false);
  assert.equal(maintenance('/admin'), false);
  assert.equal(maintenance('/fotografo'), false);
  assert.equal(maintenance('/fotografo/definir-senha'), false);
  assert.equal(maintenance('/auth/callback'), false);
  assert.equal(maintenance('/checkout/sucesso'), false);
  assert.equal(maintenance('/download'), false);
  assert.equal(maintenance('/assets/index.js'), false);
  assert.equal(maintenance('/funpace.png'), false);
  assert.equal(maintenance('/robots.txt'), false);
});

test('maintenance response content is safe for temporary SEO behavior', () => {
  const html = getMaintenanceHtml();
  assert.match(html, /Estamos preparando uma/);
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /Supabase|InfinitePay|AWS|webhook|endpoint/i);
  assert.equal(getMaintenanceRetryAfter('900'), '900');
  assert.equal(getMaintenanceRetryAfter('invalid'), '3600');
});

test('Vercel evaluates maintenance mode in request middleware, not build config', () => {
  const middleware = readFileSync('middleware.ts', 'utf8');
  const vercel = readFileSync('vercel.mjs', 'utf8');

  assert.match(middleware, /process\.env\.MAINTENANCE_MODE/);
  assert.match(middleware, /return next\(\)/);
  assert.match(middleware, /status: 503/);
  assert.match(middleware, /'Retry-After': getMaintenanceRetryAfter\(\)/);
  assert.doesNotMatch(vercel, /process\.env\.MAINTENANCE_MODE/);
  assert.match(vercel, /source: '\/:path\*', destination: '\/index\.html'/);
});
