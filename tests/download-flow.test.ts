import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildSafeDownloadPath, shouldUseSafeDownloadPage } from '../src/lib/download-flow';

test('safe download page preserves order and item without exposing a temporary token', () => {
  const path = buildSafeDownloadPath(
    '0f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f',
    '1f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f',
    'expired',
  );
  assert.equal(
    path,
    '/download?order=0f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f&item=1f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f&reason=expired',
  );
  assert.doesNotMatch(path, /token=/);
});

test('Android and iPhone use the safe page while desktop keeps direct attachment download', () => {
  assert.equal(shouldUseSafeDownloadPage({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', maxTouchPoints: 5 }), true);
  assert.equal(shouldUseSafeDownloadPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)', maxTouchPoints: 5 }), true);
  assert.equal(shouldUseSafeDownloadPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), false);
});

test('download GET failures redirect to the friendly page and token generation stays authorized', () => {
  const endpoint = readFileSync('server/api/downloads/authorize.ts', 'utf8');
  const page = readFileSync('src/routes/DownloadSeguro.tsx', 'utf8');

  assert.match(endpoint, /redirectToFriendlyDownload/);
  assert.match(endpoint, /res\.status\(303\)\.end\(\)/);
  assert.doesNotMatch(endpoint, /return res\.status\(status\)\.json\(\{ error: error\?\.message/);
  assert.doesNotMatch(endpoint, /res\.status\(502\)\.json/);
  assert.match(endpoint, /order\.status !== 'paid'/);
  assert.match(endpoint, /belongsToUser/);
  assert.match(endpoint, /item\.orderId !== orderId/);
  assert.match(page, /Este link expirou por segurança/);
  assert.match(page, /Gerar novo link de download/);
  assert.match(page, /Baixar novamente/);
});

test('download lifecycle writes generated, used, expired and invalid audit details', () => {
  const endpoint = readFileSync('server/api/downloads/authorize.ts', 'utf8');

  assert.match(endpoint, /download_token_generated/);
  assert.match(endpoint, /download_token_used/);
  assert.match(endpoint, /TOKEN_EXPIRED/);
  assert.match(endpoint, /TOKEN_USED/);
  assert.match(endpoint, /TOKEN_INVALID/);
  assert.match(endpoint, /download_token_expired/);
  assert.match(endpoint, /download_token_reused/);
  assert.match(endpoint, /download_token_invalid/);
  assert.match(endpoint, /security_download_denied/);
  assert.match(endpoint, /mediaId/);
  assert.match(endpoint, /userId/);
  assert.match(endpoint, /email/);
});

test('checkout sends the gateway to the friendly success route', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const checkout = readFileSync('api/checkout/create-session.ts', 'utf8');

  assert.match(app, /successUrl: `\$\{window\.location\.origin\}\/checkout\/sucesso`/);
  assert.match(app, /path="\/checkout\/sucesso"/);
  assert.match(checkout, /\/checkout\/sucesso/);
  assert.doesNotMatch(checkout, /fallback = `\$\{proto\}:\/\/\$\{host\}\/api\/downloads/);
});

test('Vercel Hobby deployment stays within twelve serverless function files', () => {
  const collectFunctions = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectFunctions(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
  const functions = collectFunctions('api');
  const vercel = readFileSync('vercel.mjs', 'utf8');
  const dispatcher = readFileSync('api/system.ts', 'utf8');

  assert.equal(functions.length, 12, functions.join('\n'));
  assert.match(vercel, /source: '\/api\/downloads\/authorize'[\s\S]*destination: '\/api\/system\?route=downloads-authorize'/);
  assert.match(dispatcher, /route === 'downloads-authorize'/);
  assert.match(dispatcher, /server\/api\/downloads\/authorize/);
});
