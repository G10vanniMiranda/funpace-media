import 'dotenv/config';
import pg from 'pg';
import { processPhotoFaceIndex } from '../server/face/face-indexing.js';

type Mode = 'diagnose' | 'dry-run' | 'run';
type Product = {
  id: string;
  eventId: string | null;
  photographerId: string | null;
  eventPhotographerId: string | null;
  storagePath: string | null;
  url: string | null;
  faceIndexStatus: string;
  faceIndexAttempts: number;
  faceIndexRunId: string | null;
  faceProcessingStartedAt: Date | null;
  createdAt: Date;
  existingFaces: number;
};

type StorageProbe = { exists: boolean; status: number | null; error: string | null; sourceUrl: string | null };
type Candidate = Product & StorageProbe & { storageKey: string | null; eligible: boolean; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : 'true'];
}));
const mode = String(args.get('mode') || 'diagnose') as Mode;
const limit = Math.max(1, Number(args.get('limit') || 10));
const concurrency = Math.max(1, Math.min(3, Number(args.get('concurrency') || 1)));
const checkpointSize = Math.max(1, Math.min(250, Number(args.get('checkpoint-size') || 25)));
const eventId = args.get('event-id') || null;
const createdFrom = args.get('created-from') || null;
const createdTo = args.get('created-to') || null;
const confirmation = args.get('confirm') || '';
const pinnedIds = String(args.get('product-ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
const resumeStale = args.get('resume-stale-processing') === 'true';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
let stopping = false;

function sourceUrl(photo: Pick<Product, 'storagePath' | 'url'>) {
  const source = String(photo.storagePath || photo.url || '').trim();
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return source;
  const base = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/${encodeURI(source.replace(/^\/+/, ''))}` : null;
}

function storageKey(photo: Pick<Product, 'storagePath' | 'url'>) {
  const value = String(photo.storagePath || photo.url || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  try { return new URL(value).pathname.replace(/^\/+/, ''); } catch { return null; }
}

async function probeStorage(photo: Product): Promise<StorageProbe> {
  const url = sourceUrl(photo);
  if (!url) return { exists: false, status: null, error: 'storage_source_unresolved', sourceUrl: null };
  let last: StorageProbe = { exists: false, status: null, error: 'storage_probe_failed', sourceUrl: url };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      let response = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (response.status === 405) response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
      last = { exists: response.ok, status: response.status, error: response.ok ? null : `http_${response.status}`, sourceUrl: url };
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) return last;
    } catch (error: any) {
      last = { exists: false, status: null, error: String(error?.name || 'storage_probe_failed'), sourceUrl: url };
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  return last;
}

async function mapConcurrent<T, R>(items: T[], width: number, task: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index]);
    }
  }));
  return output;
}

function filters(alias = 'p') {
  const stateFilter = resumeStale
    ? `(${alias}."faceIndexStatus" = 'pending' or (${alias}."faceIndexStatus" = 'processing' and ${alias}."faceProcessingStartedAt" < now() - interval '15 minutes'))`
    : `${alias}."faceIndexStatus" = 'pending'`;
  const clauses = [`${alias}.status = 'published'`, `${alias}.type = 'IMG'`, stateFilter];
  const values: unknown[] = [];
  if (eventId) { values.push(eventId); clauses.push(`${alias}."eventId" = $${values.length}`); }
  if (createdFrom) { values.push(createdFrom); clauses.push(`${alias}."createdAt" >= $${values.length}::timestamptz`); }
  if (createdTo) { values.push(createdTo); clauses.push(`${alias}."createdAt" < $${values.length}::timestamptz`); }
  return { sql: clauses.join(' and '), values };
}

async function loadPending(): Promise<Product[]> {
  const where = filters();
  const result = await pool.query(`
    select p.id, p."eventId", p."vendedorId" as "photographerId",
      e."photographerId" as "eventPhotographerId", p."storagePath", p.url,
      p."faceIndexStatus", p."faceIndexAttempts", p."faceIndexRunId",
      p."faceProcessingStartedAt", p."createdAt",
      count(f.face_id)::int as "existingFaces"
    from public.products p
    left join public.events e on e.id = p."eventId"
    left join public.photo_faces f on f.photo_id = p.id
    where ${where.sql}
    group by p.id, e."photographerId"
    order by p."createdAt" asc, p.id asc
  `, where.values);
  return result.rows;
}

function integrityReason(photo: Product) {
  if (!photo.eventId) return 'missing_event_id';
  if (!photo.photographerId) return 'missing_photographer_id';
  if (!UUID.test(photo.id)) return 'invalid_product_id';
  if (!UUID.test(photo.eventId)) return 'invalid_event_id';
  if (!UUID.test(photo.photographerId)) return 'invalid_photographer_id';
  if (!photo.eventPhotographerId) return 'event_not_found';
  if (photo.eventPhotographerId !== photo.photographerId) return 'event_photographer_mismatch';
  if (photo.existingFaces > 0) return 'pending_with_existing_photo_faces';
  if (!sourceUrl(photo)) return 'missing_storage_reference';
  return null;
}

async function classify(photos: Product[]) {
  return mapConcurrent(photos, 8, async (photo): Promise<Candidate> => {
    const integrity = integrityReason(photo);
    const probe = integrity ? { exists: false, status: null, error: 'not_probed_due_to_integrity', sourceUrl: sourceUrl(photo) } : await probeStorage(photo);
    const reason = integrity || (probe.exists ? 'published_pending_integrity_and_storage_valid' : 'storage_object_missing');
    return { ...photo, ...probe, storageKey: storageKey(photo), eligible: !integrity && probe.exists, reason };
  });
}

async function diagnostic(candidates: Candidate[]) {
  const statuses = await pool.query(`
    select p."faceIndexStatus" as status, count(*)::int as count
    from public.products p where p.status = 'published' and p.type = 'IMG'
    group by p."faceIndexStatus"
  `);
  const faceRows = await pool.query('select count(*)::int as count from public.photo_faces');
  const stuck = await pool.query(`
    select count(*)::int as count from public.products
    where "faceIndexStatus" = 'processing' and "faceProcessingStartedAt" < now() - interval '15 minutes'
  `);
  const counts = Object.fromEntries(statuses.rows.map((row) => [row.status, row.count]));
  const byReason = Object.fromEntries([...new Set(candidates.map((row) => row.reason))].map((reason) => [reason, candidates.filter((row) => row.reason === reason).length]));
  return {
    generatedAt: new Date().toISOString(), scope: { eventId, createdFrom, createdTo, resumeStaleProcessing: resumeStale },
    totals: { pending: counts.pending || 0, processing: counts.processing || 0, indexed: counts.indexed || 0, no_face: counts.no_face || 0, failed: counts.failed || 0, photo_faces: faceRows.rows[0].count },
    pending: {
      scopedPublishedImages: candidates.length,
      withEventId: candidates.filter((p) => Boolean(p.eventId)).length,
      withoutEventId: candidates.filter((p) => !p.eventId).length,
      withPhotographerId: candidates.filter((p) => Boolean(p.photographerId)).length,
      withoutPhotographerId: candidates.filter((p) => !p.photographerId).length,
      storageExists: candidates.filter((p) => p.exists).length,
      storageMissingOrUnreachable: candidates.filter((p) => !p.exists && p.error !== 'not_probed_due_to_integrity').length,
      notProbedDueToIntegrity: candidates.filter((p) => p.error === 'not_probed_due_to_integrity').length,
      eligible: candidates.filter((p) => p.eligible).length,
      ineligible: candidates.filter((p) => !p.eligible).length,
      byReason,
    },
    processingOlderThan15Minutes: stuck.rows[0].count,
  };
}

async function getState(id: string) {
  const result = await pool.query(`select "faceIndexStatus", "faceIndexAttempts", "faceIndexRunId", "faceProcessingStartedAt", "faceIndexErrorCode", "faceIndexError" from public.products where id = $1`, [id]);
  return result.rows[0];
}

async function getFaces(id: string) {
  const result = await pool.query('select face_id, image_id, event_id, photo_id, photographer_id, confidence from public.photo_faces where photo_id = $1 order by face_id', [id]);
  return result.rows;
}

async function processCandidate(candidate: Candidate) {
  const started = Date.now();
  const before = await getState(candidate.id);
  const facesBefore = await getFaces(candidate.id);
  const sequence: Array<{ status: string; at: string }> = [{ status: before.faceIndexStatus, at: new Date().toISOString() }];
  let observedRunId: string | null = null;
  let observing = true;
  const observer = (async () => {
    while (observing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = await getState(candidate.id);
      observedRunId ||= state.faceIndexRunId;
      if (sequence.at(-1)?.status !== state.faceIndexStatus) sequence.push({ status: state.faceIndexStatus, at: new Date().toISOString() });
    }
  })();
  try {
    const result = await processPhotoFaceIndex({ photoId: candidate.id, eventId: candidate.eventId!, photographerId: candidate.photographerId! });
    observing = false;
    await observer;
    const after = await getState(candidate.id);
    if (sequence.at(-1)?.status !== after.faceIndexStatus) sequence.push({ status: after.faceIndexStatus, at: new Date().toISOString() });
    const facesAfter = await getFaces(candidate.id);
    return { productId: candidate.id, eventId: candidate.eventId, photographerId: candidate.photographerId, statusPrevious: before.faceIndexStatus, statusFinal: after.faceIndexStatus, sequence, faceIndexAttempts: after.faceIndexAttempts, faceIndexRunId: observedRunId, durationMs: Date.now() - started, faces: result.facesIndexed, faceIdsPersisted: facesAfter.map((row) => row.face_id), linesCreated: Math.max(0, facesAfter.length - facesBefore.length), awsCalls: result.reused ? 0 : 1, reused: result.reused, errorCode: null, error: null, result: 'processed' };
  } catch (error: any) {
    observing = false;
    await observer;
    const after = await getState(candidate.id);
    if (sequence.at(-1)?.status !== after.faceIndexStatus) sequence.push({ status: after.faceIndexStatus, at: new Date().toISOString() });
    return { productId: candidate.id, eventId: candidate.eventId, photographerId: candidate.photographerId, statusPrevious: before.faceIndexStatus, statusFinal: after.faceIndexStatus, sequence, faceIndexAttempts: after.faceIndexAttempts, faceIndexRunId: observedRunId, durationMs: Date.now() - started, faces: 0, faceIdsPersisted: [], linesCreated: 0, awsCalls: 0, reused: false, errorCode: after.faceIndexErrorCode || String(error?.name || 'FaceIndexError'), error: after.faceIndexError || String(error?.message || error), result: 'failed' };
  }
}

async function runPilot(selected: Candidate[], initialEligible: number) {
  const started = Date.now();
  const cpuStarted = process.cpuUsage();
  const results: any[] = [];
  let consecutiveFailures = 0;
  let stopReason: string | null = null;
  const checkpoints: any[] = [];
  const abnormalAverageMs = Math.max(1_000, Number(process.env.FACE_BACKFILL_ABNORMAL_AVERAGE_MS || 15_000));
  const systemicError = (result: any) => result.statusFinal === 'failed' && /AccessDenied|UnrecognizedClient|ExpiredToken|InvalidSignature|credential|database|connection terminated|ECONNREFUSED|storage|S3|Download da foto publicada|fetch failed/i.test(`${result.errorCode || ''} ${result.error || ''}`);
  process.once('SIGINT', () => { stopping = true; console.warn(JSON.stringify({ event: 'backfill:stop-requested', message: 'No new photos will be scheduled; in-flight work will finish.' })); });

  for (let offset = 0; offset < selected.length && !stopping; offset += checkpointSize) {
    const chunk = selected.slice(offset, offset + checkpointSize);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, chunk.length) }, async () => {
      while (!stopping && cursor < chunk.length) {
        const photo = chunk[cursor++];
        const result = await processCandidate(photo);
        results.push(result);
        consecutiveFailures = result.statusFinal === 'failed' ? consecutiveFailures + 1 : 0;
        console.log(JSON.stringify({ event: 'backfill:photo', ...result }));
        if (systemicError(result)) {
          stopping = true;
          stopReason = `systemic_error:${result.errorCode || 'FaceIndexError'}`;
        } else if (consecutiveFailures >= 6) {
          stopping = true;
          stopReason = 'more_than_5_consecutive_failures';
        }
      }
    }));

    const processedIds = results.map((row) => row.productId);
    const duplicateRows = await pool.query(`select photo_id, face_id, count(*)::int as count from public.photo_faces where photo_id = any($1::uuid[]) group by photo_id, face_id having count(*) > 1`, [processedIds]);
    const globalProcessing = await pool.query(`select count(*)::int as count from public.products where "faceIndexStatus" = 'processing'`);
    const elapsedMs = Date.now() - started;
    const averageMs = results.length ? Math.round(results.reduce((sum, row) => sum + row.durationMs, 0) / results.length) : 0;
    const photosPerMinute = elapsedMs ? Number((results.length * 60_000 / elapsedMs).toFixed(2)) : 0;
    const awsCalls = results.reduce((sum, row) => sum + row.awsCalls, 0);
    const photoFaceLinesCreated = results.reduce((sum, row) => sum + row.linesCreated, 0);
    const workerUtilizationPercent = elapsedMs
      ? Number((results.reduce((sum, row) => sum + row.durationMs, 0) * 100 / (elapsedMs * concurrency)).toFixed(2))
      : 0;
    const memory = process.memoryUsage();
    const checkpoint = {
      number: checkpoints.length + 1,
      processed: results.length,
      indexed: results.filter((row) => row.statusFinal === 'indexed').length,
      no_face: results.filter((row) => row.statusFinal === 'no_face').length,
      failed: results.filter((row) => row.statusFinal === 'failed').length,
      processing: globalProcessing.rows[0].count,
      duplicates: duplicateRows.rows.length,
      averageMs,
      photosPerMinute,
      awsCalls,
      photoFaceLinesCreated,
      remainingEligibleEstimate: Math.max(0, initialEligible - results.length),
      workerUtilizationPercent,
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
      elapsedMs,
    };
    checkpoints.push(checkpoint);
    console.log(JSON.stringify({ event: 'backfill:checkpoint', ...checkpoint }));
    if (duplicateRows.rows.length) { stopping = true; stopReason = 'duplicate_face_ids'; }
    else if (globalProcessing.rows[0].count > 0) { stopping = true; stopReason = 'processing_not_zero_at_checkpoint'; }
    else if (averageMs > abnormalAverageMs) { stopping = true; stopReason = `abnormal_average_time:${averageMs}ms`; }
    else if (checkpoints.length > 1 && photosPerMinute < checkpoints.at(-2).photosPerMinute * 0.7) { stopping = true; stopReason = `significant_speed_drop:${photosPerMinute}_photos_per_minute`; }
    else if (results.some((row) => row.statusFinal === 'indexed' && row.faces !== row.faceIdsPersisted.length)) { stopping = true; stopReason = 'face_persistence_mismatch'; }
    if (stopping) console.error(JSON.stringify({ event: 'backfill:checkpoint-stop', stopReason, checkpoint }));
  }
  const totalMs = Date.now() - started;
  const selectedIds = selected.map((row) => row.id);
  const duplicates = await pool.query(`select photo_id, face_id, count(*)::int as count from public.photo_faces where photo_id = any($1::uuid[]) group by photo_id, face_id having count(*) > 1`, [selectedIds]);
  const stuck = await pool.query(`select id from public.products where id = any($1::uuid[]) and "faceIndexStatus" = 'processing'`, [selectedIds]);
  const remaining = (await classify(await loadPending())).filter((row) => row.eligible).length;
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
  const workerUtilizationPercent = totalMs
    ? Number((results.reduce((sum, row) => sum + row.durationMs, 0) * 100 / (totalMs * concurrency)).toFixed(2))
    : 0;
  return {
    completedAt: new Date().toISOString(), batchSize: selected.length, selected: selected.length, processed: results.length,
    indexed: results.filter((r) => r.statusFinal === 'indexed').length,
    no_face: results.filter((r) => r.statusFinal === 'no_face').length,
    failed: results.filter((r) => r.statusFinal === 'failed').length,
    ignored: selected.length - results.length, stopped: stopping, stopReason, checkpoints, totalMs,
    averageMs: results.length ? Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length) : 0,
    photosPerMinute: totalMs ? Number((results.length * 60_000 / totalMs).toFixed(2)) : 0,
    awsCalls: results.reduce((sum, r) => sum + r.awsCalls, 0), facesReturned: results.reduce((sum, r) => sum + r.faces, 0),
    photoFaceLinesCreated: results.reduce((sum, r) => sum + r.linesCreated, 0), remainingEligible: remaining,
    workerUtilizationPercent,
    resourcesApproximate: {
      processCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)),
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
    },
    duplicatePhotoFaceRows: duplicates.rows, processingAfterPilot: stuck.rows, results,
  };
}

async function main() {
  if (!['diagnose', 'dry-run', 'run'].includes(mode)) throw new Error('Use --mode=diagnose, --mode=dry-run or --mode=run.');
  if (eventId && !UUID.test(eventId)) throw new Error('--event-id must be a UUID.');
  if (mode === 'run' && confirmation !== 'BACKFILL_FACE_INDEX') throw new Error('Execution blocked. Add --confirm=BACKFILL_FACE_INDEX.');
  if (mode === 'run' && limit > 10 && args.get('allow-larger-batch') !== 'true') throw new Error('Safety limit is 10. Add --allow-larger-batch only after explicit approval.');
  if (pinnedIds.some((id) => !UUID.test(id))) throw new Error('--product-ids must contain only UUIDs.');
  if (pinnedIds.length && pinnedIds.length !== limit) throw new Error('--product-ids count must equal --limit.');
  const candidates = await classify(await loadPending());
  const report = await diagnostic(candidates);
  console.log(JSON.stringify({ event: 'backfill:diagnostic', ...report }, null, 2));
  if (mode === 'diagnose') return;
  const eligible = candidates.filter((row) => row.eligible);
  const selected = pinnedIds.length
    ? pinnedIds.map((id) => eligible.find((row) => row.id === id)).filter((row): row is Candidate => Boolean(row))
    : eligible.slice(0, limit);
  console.log(JSON.stringify({ event: 'backfill:selection', dryRun: mode === 'dry-run', limit, concurrency, checkpointSize, selected: selected.map((row) => ({ productId: row.id, eventId: row.eventId, photographerId: row.photographerId, status: row.faceIndexStatus, storageKey: row.storageKey, storageExists: row.exists, reason: row.reason })) }, null, 2));
  if (mode === 'dry-run') return;
  if (selected.length !== limit) throw new Error(`Requested ${limit}, but only ${selected.length} eligible photos were selected.`);
  const result = await runPilot(selected, eligible.length);
  console.log(JSON.stringify({ event: 'backfill:final', ...result }, null, 2));
  if (result.processingAfterPilot.length || result.duplicatePhotoFaceRows.length) process.exitCode = 2;
}

main().catch((error) => { console.error(JSON.stringify({ event: 'backfill:fatal', name: error?.name, message: error?.message })); process.exitCode = 1; }).finally(() => pool.end());
