import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production health exposes build identity without environment diagnostics', () => {
  const health = readFileSync('server/api/health.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');
  assert.match(health, /GIT_COMMIT/);
  assert.match(health, /APP_VERSION/);
  assert.match(health, /secretMatches/);
  assert.match(health, /database: 'unavailable'/);
  assert.doesNotMatch(health, /error\.message/);
  assert.match(server, /app\.get\("\/api\/health", healthHandler\)/);
  assert.doesNotMatch(server, /database = "failed: " \+ err\.message/);
});

test('legacy face recovery entrypoints are locked and package scripts cannot invoke them', () => {
  const packageJson = readFileSync('package.json', 'utf8');
  const handler = readFileSync('server/face/face-handlers.ts', 'utf8');
  const backfill = readFileSync('scripts/backfill-face-indexing.ts', 'utf8');
  const pilot = readFileSync('scripts/validate-face-backfill-pilot.ts', 'utf8');
  const phase3b = readFileSync('scripts/reconcile-face-recovery-phase3b-apply.ts', 'utf8');
  assert.doesNotMatch(packageJson, /"faces:backfill"/);
  assert.doesNotMatch(packageJson, /"integrity:reconcile"/);
  assert.match(handler, /FACE_BACKFILL_ENABLED !== 'true'/);
  assert.match(backfill, /assertLegacyFaceRecoveryLocked/);
  assert.match(pilot, /assertLegacyFaceRecoveryLocked/);
  assert.match(phase3b, /if \(applyMode\) assertLegacyFaceRecoveryLocked/);
});

test('database guards reject new facial inconsistencies without rewriting history', () => {
  const sql = readFileSync('scripts/add-face-integrity-guards.sql', 'utf8');
  assert.match(sql, /products_face_integrity_guard/);
  assert.match(sql, /photo_faces_integrity_guard/);
  assert.match(sql, /photo_faces_delete_integrity_guard/);
  assert.match(sql, /face_integrity:indexed_without_photo_faces/);
  assert.match(sql, /face_integrity:photographer_mismatch/);
  assert.match(sql, /face_integrity:external_image_id_mismatch/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.products\s+set\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\.photo_faces\b/i);
});

test('production reconciliation is locked and logs redact secret-like strings', () => {
  const integrity = readFileSync('server/integrity/integrity-service.ts', 'utf8');
  const observability = readFileSync('server/shared/observability.ts', 'utf8');
  assert.match(integrity, /process\.env\.NODE_ENV === 'production'/);
  assert.match(integrity, /autoReconcileEnabled: !reconciliationLocked/);
  assert.doesNotMatch(integrity, /IndexFacesCommand|DeleteFacesCommand/);
  assert.match(observability, /redacted-aws-access-key/);
  assert.match(observability, /redacted-jwt/);
  assert.match(observability, /postgres/);
});
