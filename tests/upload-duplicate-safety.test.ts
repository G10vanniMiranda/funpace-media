import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('photographer upload detects duplicated file names before publishing', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(services, /findExistingProductByOriginalFileName/);
  assert.match(dashboard, /requestDuplicateResolution/);
  assert.match(dashboard, /duplicateBatchActionRef/);
  assert.match(dashboard, /Aplicar para todos/);
  assert.match(dashboard, /Substituir/);
  assert.match(dashboard, /Enviar como copia/);
  assert.doesNotMatch(dashboard, /duplicateAction === 'replace'[\s\S]{0,500}addProduct/);
});

test('duplicate upload copy uses unique filenames and replacement keeps product records', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(dashboard, /createCopyFileName/);
  assert.match(dashboard, /\$\{base\} \(\$\{counter\}\)\$\{extension\}/);
  assert.match(dashboard, /replaceProductMediaResilient\(existingNameProduct\.id, productPayload\)/);
  assert.match(services, /async replaceProductMedia/);
  assert.match(services, /replaceProductMediaResilient/);
  assert.match(services, /updatedAt: new Date\(\)\.toISOString\(\)/);
});

test('duplicate upload actions are audited server-side when possible', () => {
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  assert.match(services, /fetch\('\/api\/photographers\/upload-log'/);
  assert.match(server, /app\.post\("\/api\/photographers\/upload-log"/);
  assert.match(server, /isVerifiedPhotographerUser\(authUser\.id\)/);
  assert.match(server, /admin_activity_logs/);
  assert.match(server, /upload_replace/);
  assert.match(server, /upload_copy/);
});
