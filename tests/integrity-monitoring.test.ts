import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('server/integrity/integrity-service.ts', 'utf8');
const schema = readFileSync('scripts/add-integrity-monitoring.sql', 'utf8');

test('integrity layer is additive, auditable and cannot invoke face mutation APIs', () => {
  assert.match(service, /ListFacesCommand/);
  assert.doesNotMatch(service, /IndexFacesCommand/);
  assert.doesNotMatch(service, /DeleteFacesCommand/);
  assert.match(service, /integrity_audit_logs/);
  assert.match(service, /value_before,value_after,reason,confidence,decision_origin/);
  assert.match(service, /on conflict\(idempotency_key\) do nothing/);
  assert.match(service, /jsonb_to_recordset/);
  assert.match(service, /worker_interrupted_before_completion/);
  assert.match(service, /JSON\.stringify\(rule\.channels \|\| \[\]\)/);
});

test('automatic reconciliation fails closed and requires 99.9 confidence plus cutoff', () => {
  assert.match(service, /minimumAutoConfidence: 99\.9/);
  assert.match(service, /autoReconcileEnabled: boolEnv\('INTEGRITY_AUTO_RECONCILE_ENABLED'\) && Number\.isFinite\(cutoffMs\)/);
  assert.match(service, /Number\(findingRow\.confidence\) < config\.minimumAutoConfidence/);
  assert.match(service, /new Date\(entityProduct\.createdAt\)\.getTime\(\) < cutoffMs/);
  assert.match(service, /fill_face_photographer/);
  assert.match(service, /reconstruct_photo_faces/);
});

test('monitoring schema includes runs, findings, review queue, audit, metrics and alerts', () => {
  for (const table of ['integrity_runs', 'integrity_findings', 'integrity_review_queue', 'integrity_audit_logs', 'integrity_metrics', 'integrity_alert_rules', 'integrity_alerts']) {
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(schema, /pending.*approved.*rejected.*corrected/);
  assert.match(schema, /public\.is_admin\(\)/);
});

test('admin dashboard and protected routes expose real-time integrity controls', () => {
  const dashboard = readFileSync('src/components/admin/IntegrityDashboard.tsx', 'utf8');
  const adminApi = readFileSync('server/api/admin/integrity.ts', 'utf8');
  const cron = readFileSync('server/api/integrity/cron.ts', 'utf8');
  assert.match(dashboard, /setInterval\(\(\) => void refresh\(true\), 30_000\)/);
  assert.match(dashboard, /Fila de revisão humana/);
  assert.match(adminApi, /role === 'admin' \|\| role === 'super_admin'/);
  assert.match(cron, /OPERATIONS_SECRET/);
  assert.match(cron, /runIntegrityScan\(\{ reconcile: true/);
});
