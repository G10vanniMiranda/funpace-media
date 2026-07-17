import crypto from 'node:crypto';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { logEvent } from '../shared/observability.js';

type Row = Record<string, any>;
type Finding = {
  fingerprint: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  entityType: string;
  entityId: string | null;
  confidence: number;
  evidence: Row;
  proposedChange?: Row | null;
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const workerName = String(process.env.INTEGRITY_WORKER_NAME || `integrity-${process.pid}`);

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] || '').toLowerCase();
  return raw ? ['1', 'true', 'yes', 'on'].includes(raw) : fallback;
}

export function getIntegrityConfig() {
  const cutoff = String(process.env.INTEGRITY_AUTO_RECONCILE_SINCE || '').trim();
  const cutoffMs = cutoff ? Date.parse(cutoff) : Number.NaN;
  const reconciliationLocked = process.env.NODE_ENV === 'production' || boolEnv('INTEGRITY_RECONCILIATION_LOCKED', true);
  return {
    intervalMinutes: Math.max(5, Number(process.env.INTEGRITY_SCAN_INTERVAL_MINUTES || 15)),
    staleProcessingMinutes: Math.max(5, Number(process.env.INTEGRITY_STALE_PROCESSING_MINUTES || 15)),
    autoReconcileRequested: boolEnv('INTEGRITY_AUTO_RECONCILE_ENABLED'),
    autoReconcileCutoff: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : null,
    reconciliationLocked,
    autoReconcileEnabled: !reconciliationLocked && boolEnv('INTEGRITY_AUTO_RECONCILE_ENABLED') && Number.isFinite(cutoffMs),
    minimumAutoConfidence: 99.9,
    alertWebhookConfigured: Boolean(process.env.INTEGRITY_ALERT_WEBHOOK_URL),
    schedulerEnabled: boolEnv('INTEGRITY_SCHEDULER_ENABLED'),
  };
}

function fingerprint(category: string, entityType: string, entityId: unknown) {
  return crypto.createHash('sha256').update(`${category}\u0000${entityType}\u0000${String(entityId || '')}`).digest('hex');
}

function aliases(value: unknown) {
  const source = String(value || '').trim();
  if (!source) return [];
  const values = new Set<string>([source]);
  try {
    const url = new URL(source);
    values.add(url.pathname);
    values.add(url.pathname.replace(/^\/+/, ''));
    values.add(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    values.add(decodeURIComponent(url.pathname).split('/').pop() || '');
  } catch {
    values.add(source.replace(/^\/+/, ''));
    values.add(decodeURIComponent(source).split(/[\\/]/).pop() || '');
  }
  return [...values].filter(Boolean);
}

async function listAwsFaces() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION não configurada para auditoria.');
  const rows: Row[] = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) rows.push({ faceId: face.FaceId || null, externalImageId: face.ExternalImageId || null, imageId: face.ImageId || null, confidence: face.Confidence ?? null, modelVersion: face.IndexFacesModelVersion || null });
    nextToken = page.NextToken;
  } while (nextToken);
  return rows;
}

async function listStorageObjects() {
  const baseUrl = String(process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
  const token = String(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '');
  const bucket = String(process.env.MEDIA_BUCKET || process.env.BUCKET || '');
  if (!token || !bucket) throw new Error('Credenciais de storage não configuradas para auditoria.');
  const rows: Row[] = [];
  let page = 1;
  let pages = 1;
  do {
    const response = await fetch(`${baseUrl}/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=500`, { headers: { 'X-API-Token': token } });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Storage HTTP ${response.status}`);
    rows.push(...(payload.files || []).filter((file: Row) => !file.deleted_at && file.status !== 'deleted' && file.storage_exists !== false));
    pages = Number(payload?.pagination?.total_pages || 1);
    page += 1;
  } while (page <= pages);
  return rows;
}

async function loadState() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const products = (await client.query('select * from public.products order by id')).rows;
    const faces = (await client.query('select * from public.photo_faces order by face_id')).rows;
    const events = (await client.query('select * from public.events order by id')).rows;
    const photographers = (await client.query('select * from public.photographers order by id')).rows;
    const orders = (await client.query(`select id,status,"createdAt" from public.orders where "createdAt">=now()-interval '24 hours'`)).rows;
    const databaseVersion = (await client.query('select version()')).rows[0]?.version || null;
    await client.query('COMMIT');
    return { products, faces, events, photographers, orders, databaseVersion };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function storageSet(files: Row[]) {
  const set = new Set<string>();
  for (const file of files) for (const value of [...aliases(file.url), ...aliases(file.stored_name), ...aliases(file.file_name), ...aliases(file.file_id)]) set.add(value);
  return set;
}

function storageExists(product: Row, index: Set<string>) {
  return [...aliases(product.storagePath), ...aliases(product.url)].some((value) => index.has(value));
}

function finding(category: string, severity: Finding['severity'], entityType: string, entityId: unknown, confidence: number, evidence: Row, proposedChange?: Row | null): Finding {
  return { fingerprint: fingerprint(category, entityType, entityId), category, severity, entityType, entityId: entityId ? String(entityId) : null, confidence, evidence, proposedChange: proposedChange || null };
}

function scanState(state: Awaited<ReturnType<typeof loadState>>, awsFaces: Row[], storageFiles: Row[], staleMinutes: number) {
  const findings: Finding[] = [];
  const productsById = new Map<string, Row>(state.products.map((row: Row) => [String(row.id), row]));
  const eventsById = new Map<string, Row>(state.events.map((row: Row) => [String(row.id), row]));
  const photographers = new Set(state.photographers.map((row: Row) => String(row.id)));
  const facesById = new Map<string, Row>(state.faces.map((row: Row) => [String(row.face_id), row]));
  const awsById = new Map<string, Row>(awsFaces.map((row) => [String(row.faceId), row]));
  const awsByProduct = new Map<string, Row[]>();
  const facesByProduct = new Map<string, Row[]>();
  const storage = storageSet(storageFiles);
  for (const face of awsFaces) { const rows = awsByProduct.get(String(face.externalImageId || '')) || []; rows.push(face); awsByProduct.set(String(face.externalImageId || ''), rows); }
  for (const face of state.faces) { const rows = facesByProduct.get(String(face.photo_id)) || []; rows.push(face); facesByProduct.set(String(face.photo_id), rows); }

  for (const product of state.products) {
    const event = eventsById.get(String(product.eventId || ''));
    const hasStorage = storageExists(product, storage);
    if (!product.eventId || !event) findings.push(finding('product_event_invalid', 'warning', 'product', product.id, 0, { currentEventId: product.eventId, album: product.event, hasStorage }, null));
    if (!product.vendedorId || !photographers.has(String(product.vendedorId))) findings.push(finding('product_photographer_invalid', 'critical', 'product', product.id, 0, { photographerId: product.vendedorId }, null));
    if (event && event.photographerId !== product.vendedorId) findings.push(finding('product_event_photographer_mismatch', 'warning', 'product', product.id, 0, { eventId: event.id, eventPhotographerId: event.photographerId, productPhotographerId: product.vendedorId }, null));
    if (product.type === 'IMG' && product.status !== 'removed' && !hasStorage) findings.push(finding('storage_object_missing', 'critical', 'product', product.id, 0, { storagePath: product.storagePath, url: product.url }, null));
    if (product.faceIndexStatus === 'indexed' && !(facesByProduct.get(String(product.id)) || []).length) {
      const aws = awsByProduct.get(String(product.id)) || [];
      const eligible = aws.length > 0 && event && event.photographerId === product.vendedorId && hasStorage;
      findings.push(finding('indexed_without_photo_faces', 'critical', 'product', product.id, eligible ? 100 : 0, { eventId: product.eventId, photographerId: product.vendedorId, awsFaceIds: aws.map((face) => face.faceId), hasStorage }, eligible ? { operation: 'reconstruct_photo_faces', rows: aws } : null));
    }
    if (product.faceIndexStatus === 'processing' && product.faceProcessingStartedAt && Date.now() - new Date(product.faceProcessingStartedAt).getTime() > staleMinutes * 60_000) findings.push(finding('face_processing_stuck', 'critical', 'product', product.id, 0, { startedAt: product.faceProcessingStartedAt, runId: product.faceIndexRunId }, null));
  }

  for (const face of state.faces) {
    const product = productsById.get(String(face.photo_id));
    const event = eventsById.get(String(face.event_id));
    const aws = awsById.get(String(face.face_id));
    if (!product) findings.push(finding('face_without_product', 'critical', 'photo_face', face.face_id, 0, { photoId: face.photo_id }, null));
    if (!aws) findings.push(finding('database_face_missing_aws', 'critical', 'photo_face', face.face_id, 0, { photoId: face.photo_id }, null));
    if (product && face.event_id !== product.eventId) findings.push(finding('face_event_mismatch', 'critical', 'photo_face', face.face_id, 0, { faceEventId: face.event_id, productEventId: product.eventId }, null));
    if (!face.photographer_id || (product?.vendedorId && face.photographer_id !== product.vendedorId)) {
      const eligible = !face.photographer_id && product && event && product.eventId === face.event_id && product.vendedorId === event.photographerId && aws?.externalImageId === face.photo_id && storageExists(product, storage);
      findings.push(finding('face_photographer_invalid', 'warning', 'photo_face', face.face_id, eligible ? 100 : 0, { photoId: face.photo_id, currentPhotographerId: face.photographer_id, productPhotographerId: product?.vendedorId, eventPhotographerId: event?.photographerId }, eligible ? { operation: 'fill_face_photographer', photographerId: product.vendedorId } : null));
    }
  }

  for (const face of awsFaces) {
    if (facesById.has(String(face.faceId))) continue;
    const product = productsById.get(String(face.externalImageId || ''));
    findings.push(finding(product ? 'aws_orphan_face' : 'aws_face_without_product', product ? 'warning' : 'critical', 'aws_face', face.faceId, 0, { externalImageId: face.externalImageId, productExists: Boolean(product) }, null));
  }

  const databaseDuplicates = state.faces.reduce((map, face) => map.set(String(face.face_id), (map.get(String(face.face_id)) || 0) + 1), new Map<string, number>());
  for (const [faceId, count] of databaseDuplicates) if (count > 1) findings.push(finding('duplicate_database_face_id', 'critical', 'photo_face', faceId, 0, { count }, null));
  const awsDuplicates = awsFaces.reduce((map, face) => map.set(String(face.faceId), (map.get(String(face.faceId)) || 0) + 1), new Map<string, number>());
  for (const [faceId, count] of awsDuplicates) if (count > 1) findings.push(finding('duplicate_aws_face_id', 'critical', 'aws_face', faceId, 0, { count }, null));

  return findings;
}

async function persistFindings(runId: string, findings: Finding[]) {
  const rows: Row[] = [];
  for (let offset = 0; offset < findings.length; offset += 1000) {
    const batch = findings.slice(offset, offset + 1000).map((item) => ({ fingerprint: item.fingerprint, category: item.category, severity: item.severity, entity_type: item.entityType, entity_id: item.entityId, confidence: item.confidence, evidence: item.evidence, proposed_change: item.proposedChange }));
    const result = await pool.query(`with input as (
      select * from jsonb_to_recordset($2::jsonb) as x(fingerprint text,category text,severity text,entity_type text,entity_id text,confidence numeric,evidence jsonb,proposed_change jsonb)
    ) insert into public.integrity_findings(fingerprint,run_id,category,severity,entity_type,entity_id,confidence,evidence,proposed_change)
      select fingerprint,$1,category,severity,entity_type,entity_id,confidence,evidence,proposed_change from input
      on conflict(fingerprint) do update set run_id=excluded.run_id,severity=excluded.severity,confidence=excluded.confidence,evidence=excluded.evidence,proposed_change=excluded.proposed_change,last_seen_at=now(),occurrence_count=public.integrity_findings.occurrence_count+1,status=case when public.integrity_findings.status='resolved' then 'open' else public.integrity_findings.status end,resolved_at=null
      returning *`, [runId, JSON.stringify(batch)]);
    rows.push(...result.rows);
  }
  return rows;
}

async function enqueueReviews(findingRows: Row[]) {
  for (let offset = 0; offset < findingRows.length; offset += 1000) {
    const batch = findingRows.slice(offset, offset + 1000).map((row) => ({ finding_id: row.id, proposal: row.proposed_change || {} }));
    await pool.query(`with input as (select * from jsonb_to_recordset($1::jsonb) as x(finding_id uuid,proposal jsonb))
      insert into public.integrity_review_queue(finding_id,proposal) select finding_id,proposal from input
      on conflict(finding_id) do update set proposal=excluded.proposal`, [JSON.stringify(batch)]);
    await pool.query(`update public.integrity_findings set status='review' where id=any($1::uuid[]) and status not in ('auto_fixed','resolved')`, [batch.map((row) => row.finding_id)]);
  }
}

async function applyCorrection(runId: string, findingRow: Row, state: Awaited<ReturnType<typeof loadState>>, awsFaces: Row[]) {
  const config = getIntegrityConfig();
  if (!config.autoReconcileEnabled || Number(findingRow.confidence) < config.minimumAutoConfidence || !findingRow.proposed_change) return false;
  const products = new Map<string, Row>(state.products.map((row: Row) => [String(row.id), row]));
  const cutoffMs = Date.parse(String(config.autoReconcileCutoff));
  const entityProduct = findingRow.entity_type === 'product' ? products.get(String(findingRow.entity_id)) : products.get(String(findingRow.evidence?.photoId || ''));
  if (!entityProduct?.createdAt || new Date(entityProduct.createdAt).getTime() < cutoffMs) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (findingRow.proposed_change.operation === 'fill_face_photographer') {
      const before = (await client.query('select photographer_id from public.photo_faces where face_id=$1 for update', [findingRow.entity_id])).rows[0];
      if (!before || before.photographer_id) { await client.query('ROLLBACK'); return false; }
      const updated = await client.query('update public.photo_faces set photographer_id=$1 where face_id=$2 and photographer_id is null returning face_id', [findingRow.proposed_change.photographerId, findingRow.entity_id]);
      if (updated.rowCount !== 1) throw new Error('Atomic face photographer correction failed.');
      await client.query(`insert into public.integrity_audit_logs(run_id,finding_id,worker,service,entity_type,entity_id,field_name,value_before,value_after,reason,confidence,decision_origin,idempotency_key)
        values($1,$2,$3,'integrity-reconciler','photo_face',$4,'photographer_id',$5,$6,$7,$8,'automatic_multi_evidence',$9) on conflict(idempotency_key) do nothing`, [runId, findingRow.id, workerName, findingRow.entity_id, JSON.stringify(null), JSON.stringify(findingRow.proposed_change.photographerId), findingRow.category, findingRow.confidence, `${findingRow.fingerprint}:photographer_id`]);
    } else if (findingRow.proposed_change.operation === 'reconstruct_photo_faces') {
      const product = products.get(String(findingRow.entity_id));
      if (!product?.eventId || !product.vendedorId) { await client.query('ROLLBACK'); return false; }
      const liveAws = new Map(awsFaces.map((face) => [String(face.faceId), face]));
      for (const face of findingRow.proposed_change.rows || []) {
        const aws = liveAws.get(String(face.faceId));
        if (!aws || aws.externalImageId !== product.id) throw new Error('AWS evidence changed before reconstruction.');
        await client.query(`insert into public.photo_faces(face_id,image_id,event_id,photo_id,confidence,external_image_id,photographer_id,index_collection,index_model_version)
          values($1,$2,$3,$4,$5,$4,$6,$7,$8) on conflict(face_id) do nothing`, [face.faceId, face.imageId, product.eventId, product.id, face.confidence, product.vendedorId, collectionId, face.modelVersion]);
      }
      await client.query(`insert into public.integrity_audit_logs(run_id,finding_id,worker,service,entity_type,entity_id,field_name,value_before,value_after,reason,confidence,decision_origin,idempotency_key)
        values($1,$2,$3,'integrity-reconciler','product',$4,'photo_faces',$5,$6,$7,$8,'automatic_existing_aws_faces',$9) on conflict(idempotency_key) do nothing`, [runId, findingRow.id, workerName, product.id, JSON.stringify([]), JSON.stringify((findingRow.proposed_change.rows || []).map((face: Row) => face.faceId)), findingRow.category, findingRow.confidence, `${findingRow.fingerprint}:photo_faces`]);
    } else { await client.query('ROLLBACK'); return false; }
    await client.query(`update public.integrity_findings set status='auto_fixed',resolved_at=now() where id=$1`, [findingRow.id]);
    await client.query(`update public.integrity_review_queue set status='corrected',corrected_at=now() where finding_id=$1 and status='pending'`, [findingRow.id]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

function buildMetrics(state: Awaited<ReturnType<typeof loadState>>, findings: Finding[], awsFaces: Row[], storageFiles: Row[], durationMs: number): Record<string, number> {
  const count = (category: string) => findings.filter((item) => item.category === category).length;
  const photos = state.products.filter((row: Row) => row.type === 'IMG');
  const indexed = photos.filter((row: Row) => row.faceIndexStatus === 'indexed').length;
  const failed = photos.filter((row: Row) => row.faceIndexStatus === 'failed').length;
  const pending = photos.filter((row: Row) => row.faceIndexStatus === 'pending').length;
  const processing = photos.filter((row: Row) => row.faceIndexStatus === 'processing').length;
  const critical = findings.filter((item) => item.severity === 'critical').length;
  const health = Math.max(0, Math.min(100, 100 - ((critical * 5 + (findings.length - critical)) / Math.max(1, photos.length + state.faces.length)) * 100));
  const durations = photos.flatMap((row: Row) => row.faceProcessingStartedAt && row.faceProcessedAt ? [new Date(row.faceProcessedAt).getTime() - new Date(row.faceProcessingStartedAt).getTime()] : []).filter((value) => value >= 0);
  return {
    integrity_health_percent: Number(health.toFixed(2)), total_photos: photos.length, total_products: state.products.length, total_faces: state.faces.length,
    aws_faces: awsFaces.length, storage_objects: storageFiles.length, face_indexed: indexed, face_pending: pending, face_processing: processing, face_failed: failed,
    face_processing_stuck: count('face_processing_stuck'), aws_orphan_faces: count('aws_orphan_face'), aws_faces_without_product: count('aws_face_without_product'),
    indexed_without_faces: count('indexed_without_photo_faces'), integrity_critical_findings: critical, integrity_findings: findings.length,
    invalid_product_events: count('product_event_invalid'), face_event_mismatches: count('face_event_mismatch'), face_photographer_invalid: count('face_photographer_invalid'),
    duplicate_database_face_ids: count('duplicate_database_face_id'), duplicate_aws_face_ids: count('duplicate_aws_face_id'),
    photos_per_hour: photos.filter((row: Row) => row.createdAt && Date.now() - new Date(row.createdAt).getTime() <= 3_600_000).length,
    faces_indexed_per_hour: state.faces.filter((row: Row) => row.created_at && Date.now() - new Date(row.created_at).getTime() <= 3_600_000).length,
    recognition_success_percent: photos.length ? Number(((indexed / photos.length) * 100).toFixed(2)) : 100,
    face_error_percent: photos.length ? Number(((failed / photos.length) * 100).toFixed(2)) : 0,
    average_face_processing_ms: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    active_events: state.events.filter((row: Row) => row.status === 'active').length,
    active_photographers: state.photographers.filter((row: Row) => row.status === 'active' && row.approved === true).length,
    paid_orders_24h: state.orders.filter((row: Row) => row.status === 'paid').length,
    audit_duration_ms: durationMs,
  };
}

async function persistMetrics(runId: string, metrics: Record<string, number>) {
  const entries = Object.entries(metrics);
  if (!entries.length) return;
  const values: unknown[] = [];
  const groups = entries.map(([name, value], index) => { values.push(runId, name, value); const offset = index * 3; return `($${offset + 1},$${offset + 2},$${offset + 3})`; });
  await pool.query(`insert into public.integrity_metrics(run_id,metric_name,metric_value) values ${groups.join(',')}`, values);
}

function compare(value: number, operator: string, threshold: number) {
  if (operator === 'gte') return value >= threshold;
  if (operator === 'lt') return value < threshold;
  if (operator === 'lte') return value <= threshold;
  return value > threshold;
}

async function processAlerts(runId: string, metrics: Record<string, number>) {
  const rules = (await pool.query('select * from public.integrity_alert_rules where enabled=true')).rows;
  for (const rule of rules) {
    const value = Number(metrics[rule.metric_name]);
    if (!Number.isFinite(value) || !compare(value, rule.operator, Number(rule.threshold))) continue;
    const recent = await pool.query(`select id from public.integrity_alerts where rule_id=$1 and created_at>now()-($2::text||' minutes')::interval limit 1`, [rule.id, rule.cooldown_minutes]);
    if (recent.rowCount) continue;
    const alert = (await pool.query(`insert into public.integrity_alerts(rule_id,run_id,metric_name,metric_value,threshold,severity,channels) values($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`, [rule.id, runId, rule.metric_name, value, rule.threshold, rule.severity, JSON.stringify(rule.channels || [])])).rows[0];
    const webhook = String(process.env.INTEGRITY_ALERT_WEBHOOK_URL || '');
    if (webhook) {
      try {
        const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'funpace-integrity', alertId: alert.id, severity: alert.severity, metric: alert.metric_name, value, threshold: Number(rule.threshold), channels: rule.channels, occurredAt: alert.created_at }) });
        await pool.query(`update public.integrity_alerts set status=$1,delivery=$2,sent_at=case when $1='sent' then now() else null end where id=$3`, [response.ok ? 'sent' : 'failed', { httpStatus: response.status }, alert.id]);
      } catch (error: any) { await pool.query(`update public.integrity_alerts set status='failed',delivery=$1 where id=$2`, [{ error: error?.message || String(error) }, alert.id]); }
    }
    logEvent(rule.severity === 'critical' ? 'error' : 'warn', 'integrity:alert', { alertId: alert.id, metric: rule.metric_name, value, threshold: Number(rule.threshold) });
  }
}

export async function runIntegrityScan(input: { reconcile?: boolean; triggerSource?: string; actorId?: string | null } = {}) {
  const lock = await pool.connect();
  const locked = (await lock.query(`select pg_try_advisory_lock(hashtext('funpace_integrity_monitor')) as locked`)).rows[0]?.locked === true;
  if (!locked) { lock.release(); return { skipped: true, reason: 'scan_already_running' }; }
  const started = Date.now();
  let runId = '';
  try {
    await pool.query(`update public.integrity_runs set status='failed',error=coalesce(error,'worker_interrupted_before_completion'),completed_at=now() where status='running'`);
    const config = getIntegrityConfig();
    const mode = input.reconcile && config.autoReconcileEnabled ? 'reconcile' : 'audit';
    runId = (await pool.query(`insert into public.integrity_runs(mode,trigger_source,code_version,configuration) values($1,$2,$3,$4) returning id`, [mode, input.triggerSource || 'manual', process.env.GIT_COMMIT || null, config])).rows[0].id;
    const [state, awsFaces, storageFiles] = await Promise.all([loadState(), listAwsFaces(), listStorageObjects()]);
    const findings = scanState(state, awsFaces, storageFiles, config.staleProcessingMinutes);
    const findingRows = await persistFindings(runId, findings);
    let fixed = 0;
    const reviewRows: Row[] = [];
    for (const row of findingRows) {
      const corrected = input.reconcile ? await applyCorrection(runId, row, state, awsFaces) : false;
      if (corrected) fixed += 1;
      else reviewRows.push(row);
    }
    await enqueueReviews(reviewRows);
    await pool.query(`update public.integrity_findings set status='resolved',resolved_at=now() where last_seen_at < (select started_at from public.integrity_runs where id=$1) and status in ('open','review')`, [runId]);
    const metrics = buildMetrics(state, findings, awsFaces, storageFiles, Date.now() - started);
    const pendingReview = Number((await pool.query(`select count(*)::int count from public.integrity_review_queue where status='pending'`)).rows[0].count);
    metrics.review_queue_pending = pendingReview;
    await persistMetrics(runId, metrics);
    await processAlerts(runId, metrics);
    const summary = { inventory: { products: state.products.length, photos: state.products.filter((row: Row) => row.type === 'IMG').length, faces: state.faces.length, awsFaces: awsFaces.length, storageObjects: storageFiles.length, events: state.events.length, photographers: state.photographers.length }, findings: findings.length, critical: findings.filter((item) => item.severity === 'critical').length, autoFixed: fixed, reviewQueued: findings.length - fixed, ignored: 0, durationMs: Date.now() - started, healthPercent: metrics.integrity_health_percent };
    await pool.query(`update public.integrity_runs set status='completed',summary=$1,completed_at=now() where id=$2`, [summary, runId]);
    logEvent('info', 'integrity:scan:complete', { runId, ...summary });
    return { runId, mode, summary, metrics, databaseVersion: state.databaseVersion };
  } catch (error: any) {
    if (runId) await pool.query(`update public.integrity_runs set status='failed',error=$1,completed_at=now() where id=$2`, [String(error?.message || error).slice(0, 2000), runId]).catch(() => undefined);
    logEvent('error', 'integrity:scan:failed', { runId, message: error?.message || String(error) });
    throw error;
  } finally {
    await lock.query(`select pg_advisory_unlock(hashtext('funpace_integrity_monitor'))`).catch(() => undefined);
    lock.release();
  }
}

export async function getIntegrityDashboard() {
  const [runs, findings, review, alerts, audit, metricRows, rules] = await Promise.all([
    pool.query('select * from public.integrity_runs order by started_at desc limit 20'),
    pool.query(`select * from public.integrity_findings where status<>'resolved' order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,last_seen_at desc limit 500`),
    pool.query(`select q.*,f.category,f.severity,f.entity_type,f.entity_id,f.confidence,f.evidence from public.integrity_review_queue q join public.integrity_findings f on f.id=q.finding_id order by q.created_at desc limit 500`),
    pool.query('select * from public.integrity_alerts order by created_at desc limit 200'),
    pool.query('select * from public.integrity_audit_logs order by created_at desc limit 200'),
    pool.query(`select distinct on(metric_name) metric_name,metric_value,labels,captured_at from public.integrity_metrics order by metric_name,captured_at desc`),
    pool.query('select * from public.integrity_alert_rules order by metric_name'),
  ]);
  return { latestRun: runs.rows[0] || null, runs: runs.rows, findings: findings.rows, reviewQueue: review.rows, alerts: alerts.rows, corrections: audit.rows, metrics: Object.fromEntries(metricRows.rows.map((row) => [row.metric_name, Number(row.metric_value)])), metricTimestamps: Object.fromEntries(metricRows.rows.map((row) => [row.metric_name, row.captured_at])), alertRules: rules.rows, configuration: getIntegrityConfig(), generatedAt: new Date().toISOString() };
}

export async function updateReviewItem(input: { id: string; status: 'approved' | 'rejected'; reviewerId: string; note?: string }) {
  const result = await pool.query(`update public.integrity_review_queue set status=$1,reviewer_id=$2,reviewer_note=$3,decided_at=now() where id=$4 and status='pending' returning *`, [input.status, input.reviewerId, input.note || null, input.id]);
  if (!result.rows[0]) throw new Error('Item de revisão não encontrado ou já decidido.');
  await pool.query(`update public.integrity_findings set status=$1 where id=$2`, [input.status === 'rejected' ? 'ignored' : 'review', result.rows[0].finding_id]);
  return result.rows[0];
}

let scheduler: ReturnType<typeof setInterval> | null = null;
export function startIntegrityScheduler() {
  const config = getIntegrityConfig();
  if (!config.schedulerEnabled || scheduler) return;
  const execute = () => runIntegrityScan({ reconcile: true, triggerSource: 'internal_scheduler' }).catch((error) => logEvent('error', 'integrity:scheduler:error', { message: error?.message || String(error) }));
  scheduler = setInterval(execute, config.intervalMinutes * 60_000);
  scheduler.unref();
  setTimeout(execute, 15_000).unref();
  logEvent('info', 'integrity:scheduler:started', { intervalMinutes: config.intervalMinutes, autoReconcileEnabled: config.autoReconcileEnabled });
}
