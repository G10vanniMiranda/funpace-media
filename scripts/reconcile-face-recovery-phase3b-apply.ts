import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient, SearchFacesByImageCommand } from '@aws-sdk/client-rekognition';
import { assertLegacyFaceRecoveryLocked } from './legacy-face-recovery-lock.js';

type Row = Record<string, any>;
type StageName = 'event_updates' | 'photographer_updates' | 'photo_faces_reconstruction';

const approvedManifestSha = '1383953648343b1b6cf367c2f088282ad68c26279730690394a047514b6b6c16';
const approvedDir = path.resolve('artifacts/face-recovery-phase3b-dry-run/2026-07-15T17-18-52-299Z');
const applyMode = process.argv.includes('--apply');
if (applyMode) assertLegacyFaceRecoveryLocked('reconcile-face-recovery-phase3b-apply');
const executionId = process.argv.find((arg) => arg.startsWith('--execution-id='))?.slice(15) || `phase3b-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve('artifacts/face-recovery-phase3b-execution', executionId);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const threshold = Math.min(100, Math.max(0, Number(process.env.FACE_SIMILARITY_THRESHOLD || 90)));
const maxFaces = Math.min(4096, Math.max(1, Number(process.env.FACE_SEARCH_MAX_CANDIDATES || 1000)));
const publicMediaBase = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

function canonical(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
function chunks<T>(items: T[], size = 25) { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }

async function writeJson(name: string, value: unknown) {
  const target = path.join(outputDir, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, canonical(value), 'utf8');
}

async function log(event: string, detail: Row = {}) {
  const row = { timestamp: new Date().toISOString(), event, ...detail };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.appendFile(path.join(outputDir, 'execution.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  console.log(JSON.stringify(row));
}

async function loadApproved() {
  const manifestContent = await fs.readFile(path.join(approvedDir, 'manifest.json'), 'utf8');
  const actualManifestSha = sha256(manifestContent);
  if (actualManifestSha !== approvedManifestSha) throw new Error(`Approved manifest hash mismatch: ${actualManifestSha}`);
  const manifest = JSON.parse(manifestContent);
  const proposalsContent = await fs.readFile(path.join(approvedDir, 'proposals.json'), 'utf8');
  if (sha256(proposalsContent) !== manifest.proposalSha256) throw new Error('Approved proposal hash mismatch.');
  return { manifest, proposals: JSON.parse(proposalsContent), manifestSha: actualManifestSha, proposalSha: sha256(proposalsContent) };
}

async function listAwsFaces() {
  const rows: Row[] = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) rows.push({ faceId: face.FaceId || null, externalImageId: face.ExternalImageId || null, imageId: face.ImageId || null, confidence: face.Confidence ?? null, indexFacesModelVersion: face.IndexFacesModelVersion || null });
    nextToken = page.NextToken;
  } while (nextToken);
  return rows.sort((a, b) => String(a.faceId).localeCompare(String(b.faceId)));
}

async function snapshotDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const products = (await client.query('select * from public.products order by id')).rows;
    const faces = (await client.query('select * from public.photo_faces order by face_id')).rows;
    const events = (await client.query('select * from public.events order by id')).rows;
    const photographers = (await client.query('select * from public.photographers order by id')).rows;
    await client.query('COMMIT');
    return { products, faces, events, photographers };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function auditDatabase() {
  const result = await pool.query(`
    with event_issues as (
      select p.id from public.products p left join public.events e on e.id = p."eventId"
      where p."eventId" is null or e.id is null
        or (p."vendedorId" is not null and e."photographerId" is distinct from p."vendedorId")
        or (coalesce(trim(lower(p.event)), '') <> '' and trim(lower(e.name)) is distinct from trim(lower(p.event)))
    ), photographer_product_issues as (
      select p.id from public.products p
      left join public.events e on e.id = p."eventId"
      left join public.photographers ph on ph.id::text = p."vendedorId"::text
      where p."vendedorId" is null or ph.id is null or (e.id is not null and e."photographerId" is distinct from p."vendedorId")
    ), photographer_face_issues as (
      select f.face_id from public.photo_faces f
      left join public.products p on p.id = f.photo_id
      left join public.events e on e.id = f.event_id
      left join public.photographers ph on ph.id::text = f.photographer_id::text
      where f.photographer_id is null or ph.id is null
        or (p."vendedorId" is not null and f.photographer_id is distinct from p."vendedorId")
        or (e."photographerId" is not null and f.photographer_id is distinct from e."photographerId")
    )
    select
      (select count(*)::int from public.products) products,
      (select count(*)::int from public.photo_faces) photo_faces,
      (select count(*)::int from event_issues) event_issues,
      ((select count(*) from photographer_product_issues) + (select count(*) from photographer_face_issues))::int photographer_issues,
      (select count(*)::int from public.products p where p."faceIndexStatus" = 'indexed' and not exists (select 1 from public.photo_faces f where f.photo_id = p.id)) indexed_without_photo_faces,
      (select count(*)::int from (select face_id from public.photo_faces group by face_id having count(*) > 1) d) duplicate_face_ids,
      (select count(*)::int from (select photo_id, face_id from public.photo_faces group by photo_id, face_id having count(*) > 1) d) duplicate_photo_face_pairs,
      (select count(*)::int from public.photo_faces f join public.products p on p.id=f.photo_id where f.event_id is distinct from p."eventId") face_event_mismatches,
      (select count(*)::int from public.photo_faces f join public.products p on p.id=f.photo_id where f.photographer_id is distinct from p."vendedorId") face_photographer_mismatches
  `);
  return result.rows[0];
}

async function preflight(approved: Awaited<ReturnType<typeof loadApproved>>) {
  const { proposals } = approved;
  const previousPreflightExists = await fs.access(path.join(outputDir, 'preflight.json')).then(() => true).catch(() => false);
  const preflightRoot = previousPreflightExists ? `resume-preflight/${new Date().toISOString().replace(/[:.]/g, '-')}` : 'preflight';
  const [snapshot, awsFaces] = await Promise.all([snapshotDatabase(), listAwsFaces()]);
  const products = new Map<string, Row>(snapshot.products.map((row: Row) => [String(row.id), row]));
  const faces = new Map<string, Row>(snapshot.faces.map((row: Row) => [String(row.face_id), row]));
  const events = new Map<string, Row>(snapshot.events.map((row: Row) => [String(row.id), row]));
  const photographers = new Set(snapshot.photographers.map((row: Row) => String(row.id)));
  const aws = new Map<string, Row>(awsFaces.map((row: Row) => [String(row.faceId), row]));
  const divergences: Row[] = [];

  for (const row of proposals.eventUpdates) {
    const product = products.get(String(row.productId));
    const event = events.get(String(row.newEventId));
    const eventStateIsResumable = product && ((product.eventId ?? null) === (row.oldEventId ?? null) || String(product.eventId || '') === String(row.newEventId));
    if (!eventStateIsResumable || !event || String(product?.vendedorId) !== String(row.photographerId) || String(event.photographerId) !== String(row.photographerId)) divergences.push({ stage: 'event_updates', id: row.productId, reason: 'affected_state_changed' });
    const linkedFaces = snapshot.faces.filter((face: Row) => String(face.photo_id) === String(row.productId));
    if (linkedFaces.some((face: Row) => String(face.event_id) !== String(row.newEventId))) divergences.push({ stage: 'event_updates', id: row.productId, reason: 'existing_face_would_diverge_from_new_event' });
  }
  for (const row of proposals.photographerUpdates) {
    const face = faces.get(String(row.faceId));
    const product = products.get(String(row.productId));
    const event = events.get(String(row.eventId));
    const photographerStateIsResumable = face && ((face.photographer_id ?? null) === (row.oldPhotographerId ?? null) || String(face.photographer_id || '') === String(row.newPhotographerId));
    if (!photographerStateIsResumable || !product || !event || String(product.vendedorId) !== String(row.newPhotographerId) || String(event.photographerId) !== String(row.newPhotographerId)) divergences.push({ stage: 'photographer_updates', id: row.faceId, reason: 'affected_state_changed' });
  }
  for (const row of proposals.photoFaceReconstruction) {
    const product = products.get(String(row.productId));
    const event = events.get(String(row.eventId));
    const liveFace = aws.get(String(row.faceId));
    const existing = faces.get(String(row.faceId));
    const reconstructionStateIsResumable = !existing || (String(existing.photo_id) === String(row.productId) && String(existing.event_id) === String(row.eventId) && String(existing.photographer_id) === String(row.photographerId) && String(existing.image_id || '') === String(row.imageId || ''));
    if (!reconstructionStateIsResumable || !product || !event || !photographers.has(String(row.photographerId)) || !liveFace || String(liveFace.externalImageId) !== String(row.productId) || String(liveFace.imageId) !== String(row.imageId) || String(event.photographerId) !== String(row.photographerId)) divergences.push({ stage: 'photo_faces_reconstruction', id: row.faceId, reason: 'affected_state_changed' });
  }
  const snapshotArtifacts: Row[] = [];
  for (const [name, value] of Object.entries({ products: snapshot.products, photo_faces: snapshot.faces, events: snapshot.events, photographers: snapshot.photographers, aws_faces: awsFaces })) {
    const content = canonical(value);
    await writeJson(`${preflightRoot}/${name}.json`, value);
    snapshotArtifacts.push({ file: `${preflightRoot}/${name}.json`, count: (value as Row[]).length, sha256: sha256(content) });
  }
  const audit = await auditDatabase();
  const result = { checkedAt: new Date().toISOString(), manifestSha: approved.manifestSha, proposalSha: approved.proposalSha, mode: applyMode ? 'apply_requested' : 'preflight_only', snapshotArtifacts, awsCount: awsFaces.length, audit, divergences };
  await writeJson(previousPreflightExists ? `${preflightRoot}.json` : 'preflight.json', result);
  await log('preflight:complete', { divergences: divergences.length, audit, awsCount: awsFaces.length });
  if (divergences.length) throw new Error(`Preflight rejected ${divergences.length} affected rows; no mutation is allowed.`);
  return { result, aws };
}

async function validateGlobalSafety(stage: StageName, checkpoint: number) {
  const audit = await auditDatabase();
  if (Number(audit.duplicate_face_ids) || Number(audit.duplicate_photo_face_pairs)) throw new Error(`Duplicate safety gate failed after ${stage} checkpoint ${checkpoint}.`);
  return audit;
}

async function applyEventBatch(batch: Row[]) {
  const client = await pool.connect();
  let corrected = 0; let ignored = 0;
  try {
    await client.query('BEGIN');
    for (const row of batch) {
      const current = (await client.query('select "eventId", "vendedorId" from public.products where id=$1 for update', [row.productId])).rows[0];
      if (!current) throw new Error(`Product disappeared: ${row.productId}`);
      if (String(current.eventId || '') === String(row.newEventId)) { ignored += 1; continue; }
      if ((current.eventId ?? null) !== (row.oldEventId ?? null) || String(current.vendedorId) !== String(row.photographerId)) throw new Error(`Event divergence: ${row.productId}`);
      const event = (await client.query('select "photographerId" from public.events where id=$1', [row.newEventId])).rows[0];
      if (!event || String(event.photographerId) !== String(row.photographerId)) throw new Error(`Event evidence divergence: ${row.productId}`);
      const mismatches = await client.query('select face_id from public.photo_faces where photo_id=$1 and event_id is distinct from $2::uuid limit 1', [row.productId, row.newEventId]);
      if (mismatches.rowCount) throw new Error(`Existing photo_face event would diverge: ${row.productId}`);
      const updated = await client.query('update public.products set "eventId"=$1 where id=$2 and "eventId" is not distinct from $3::uuid returning id', [row.newEventId, row.productId, row.oldEventId]);
      if (updated.rowCount !== 1) throw new Error(`Atomic event update failed: ${row.productId}`);
      corrected += 1;
    }
    await client.query('COMMIT');
    return { corrected, ignored };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

async function applyPhotographerBatch(batch: Row[]) {
  const client = await pool.connect();
  let corrected = 0; let ignored = 0;
  try {
    await client.query('BEGIN');
    for (const row of batch) {
      const face = (await client.query('select photographer_id, photo_id, event_id from public.photo_faces where face_id=$1 for update', [row.faceId])).rows[0];
      if (!face) throw new Error(`Face disappeared: ${row.faceId}`);
      if (String(face.photographer_id || '') === String(row.newPhotographerId)) { ignored += 1; continue; }
      if (face.photographer_id !== null || String(face.photo_id) !== String(row.productId) || String(face.event_id) !== String(row.eventId)) throw new Error(`Photographer divergence: ${row.faceId}`);
      const evidence = (await client.query('select p."vendedorId", p."eventId", e."photographerId" from public.products p join public.events e on e.id=$2 where p.id=$1', [row.productId, row.eventId])).rows[0];
      if (!evidence || String(evidence.eventId) !== String(row.eventId) || String(evidence.vendedorId) !== String(row.newPhotographerId) || String(evidence.photographerId) !== String(row.newPhotographerId)) throw new Error(`Photographer evidence divergence: ${row.faceId}`);
      const updated = await client.query('update public.photo_faces set photographer_id=$1 where face_id=$2 and photographer_id is null returning face_id', [row.newPhotographerId, row.faceId]);
      if (updated.rowCount !== 1) throw new Error(`Atomic photographer update failed: ${row.faceId}`);
      corrected += 1;
    }
    await client.query('COMMIT');
    return { corrected, ignored };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

async function applyReconstructionBatch(batch: Row[], aws: Map<string, Row>) {
  const client = await pool.connect();
  let corrected = 0; let ignored = 0;
  try {
    await client.query('BEGIN');
    for (const row of batch) {
      const existing = (await client.query('select * from public.photo_faces where face_id=$1 for update', [row.faceId])).rows[0];
      if (existing) {
        const exact = String(existing.photo_id) === String(row.productId) && String(existing.event_id) === String(row.eventId) && String(existing.photographer_id) === String(row.photographerId) && String(existing.image_id || '') === String(row.imageId || '');
        if (!exact) throw new Error(`Existing FaceId diverges: ${row.faceId}`);
        ignored += 1; continue;
      }
      const liveFace = aws.get(String(row.faceId));
      if (!liveFace || String(liveFace.externalImageId) !== String(row.productId) || String(liveFace.imageId) !== String(row.imageId)) throw new Error(`AWS evidence divergence: ${row.faceId}`);
      const evidence = (await client.query('select p."eventId", p."vendedorId", e."photographerId" from public.products p join public.events e on e.id=$2 where p.id=$1', [row.productId, row.eventId])).rows[0];
      if (!evidence || String(evidence.eventId) !== String(row.eventId) || String(evidence.vendedorId) !== String(row.photographerId) || String(evidence.photographerId) !== String(row.photographerId)) throw new Error(`Reconstruction evidence divergence: ${row.faceId}`);
      const inserted = await client.query(`insert into public.photo_faces (face_id,image_id,event_id,photo_id,confidence,external_image_id,photographer_id,index_collection,index_model_version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (face_id) do nothing returning face_id`, [row.faceId, row.imageId, row.eventId, row.productId, row.confidence, row.awsExternalImageId, row.photographerId, collectionId, liveFace.indexFacesModelVersion]);
      if (inserted.rowCount !== 1) throw new Error(`Atomic reconstruction insert failed: ${row.faceId}`);
      corrected += 1;
    }
    await client.query('COMMIT');
    return { corrected, ignored };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

function sourceUrl(product: Row) {
  const source = String(product.storagePath || product.url || '').trim();
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return source;
  return publicMediaBase ? `${publicMediaBase}/${encodeURI(source.replace(/^\/+/, ''))}` : null;
}

async function validateRealFaceSearch(stage: StageName, preferredProductIds: string[], eventIds: string[]) {
  const preferred = preferredProductIds.length ? preferredProductIds : ['00000000-0000-0000-0000-000000000000'];
  const events = eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000'];
  let candidates = (await pool.query(`select p.id, p."eventId", p."vendedorId", p."storagePath", p.url
    from public.products p
    where p.status='published' and p.type='IMG' and coalesce(p."storagePath",p.url,'')<>''
      and exists (select 1 from public.photo_faces f where f.photo_id=p.id and f.event_id=p."eventId")
      and (p.id=any($1::uuid[]) or p."eventId"=any($2::uuid[]))
    order by (p.id=any($1::uuid[])) desc, p.id limit 20`, [preferred, events])).rows;
  let stagedAwsOnlyValidation = false;
  if (!candidates.length && stage === 'event_updates') {
    candidates = (await pool.query(`select p.id, p."eventId", p."vendedorId", p."storagePath", p.url
      from public.products p where p.status='published' and p.type='IMG' and coalesce(p."storagePath",p.url,'')<>''
        and p.id=any($1::uuid[]) and p."eventId"=any($2::uuid[])
      order by p.id limit 20`, [preferred, events])).rows;
    stagedAwsOnlyValidation = true;
  }
  const awsExternalByFace = stagedAwsOnlyValidation
    ? new Map((await listAwsFaces()).map((face) => [String(face.faceId), String(face.externalImageId || '')]))
    : new Map<string, string>();
  const attempts: Row[] = [];
  for (const candidate of candidates) {
    const url = sourceUrl(candidate);
    if (!url) { attempts.push({ productId: candidate.id, error: 'source_unresolved' }); continue; }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download_http_${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const search = await rekognition.send(new SearchFacesByImageCommand({ CollectionId: collectionId, Image: { Bytes: bytes }, FaceMatchThreshold: threshold, MaxFaces: maxFaces }));
      const matches = (search.FaceMatches || []).flatMap((match) => match.Face?.FaceId ? [{ faceId: match.Face.FaceId, similarity: match.Similarity || 0 }] : []);
      const ids = matches.map((row) => row.faceId);
      const mapped = ids.length ? (await pool.query('select face_id,photo_id,event_id,photographer_id from public.photo_faces where event_id=$1 and face_id=any($2::text[])', [candidate.eventId, ids])).rows : [];
      const expected = mapped.find((row: Row) => String(row.photo_id) === String(candidate.id));
      const stagedExpected = stagedAwsOnlyValidation ? matches.find((row) => awsExternalByFace.get(row.faceId) === String(candidate.id)) : null;
      const passed = Boolean(expected || stagedExpected);
      const result = { stage, protocol: stagedAwsOnlyValidation ? 'AWS SearchFacesByImage + corrected product event binding (photo_faces reconstruction pending by approved order)' : 'AWS SearchFacesByImage + production DB event filter', threshold, queryProductId: candidate.id, eventId: candidate.eventId, photographerId: candidate.vendedorId, awsMatches: matches.length, mappedEventMatches: mapped.length, expectedProductFound: passed, expectedFaceId: expected?.face_id || stagedExpected?.faceId || null, expectedSimilarity: matches.find((row) => row.faceId === (expected?.face_id || stagedExpected?.faceId))?.similarity || null, databaseMappingPendingApprovedStage3: stagedAwsOnlyValidation };
      attempts.push(result);
      if (result.expectedProductFound) { await writeJson(`search/${stage}.json`, { passed: true, attempts }); await log('search:passed', result); return result; }
    } catch (error: any) { attempts.push({ productId: candidate.id, eventId: candidate.eventId, error: error?.message || String(error) }); }
  }
  await writeJson(`search/${stage}.json`, { passed: false, attempts });
  throw new Error(`Real face search validation failed for ${stage}.`);
}

async function runStage(stage: StageName, items: Row[], applyBatch: (batch: Row[]) => Promise<{ corrected: number; ignored: number }>, searchProductIds: string[], searchEventIds: string[]) {
  let corrected = 0; let ignored = 0; const checkpoints: Row[] = [];
  for (const [index, batch] of chunks(items).entries()) {
    const result = await applyBatch(batch);
    corrected += result.corrected; ignored += result.ignored;
    const audit = await validateGlobalSafety(stage, index + 1);
    const checkpoint = { stage, checkpoint: index + 1, batchSize: batch.length, cumulative: Math.min((index + 1) * 25, items.length), corrected, ignored, rejected: 0, audit, completedAt: new Date().toISOString() };
    checkpoints.push(checkpoint);
    await writeJson(`checkpoints/${stage}-${String(index + 1).padStart(3, '0')}.json`, checkpoint);
    await log('checkpoint:complete', checkpoint);
  }
  const search = await validateRealFaceSearch(stage, searchProductIds, searchEventIds);
  const awsFaces = await listAwsFaces();
  const result = { stage, expected: items.length, corrected, ignored, rejected: 0, checkpoints: checkpoints.length, audit: await auditDatabase(), awsFaces: awsFaces.length, search, completedAt: new Date().toISOString() };
  await writeJson(`stages/${stage}.json`, result);
  await log('stage:complete', { stage, expected: items.length, corrected, ignored, checkpoints: checkpoints.length, awsFaces: awsFaces.length });
  return result;
}

async function main() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION is required.');
  const approved = await loadApproved();
  await fs.mkdir(outputDir, { recursive: true });
  await writeJson('execution-manifest.json', { executionId, status: 'preflight', approvedManifestSha, proposalSha: approved.proposalSha, applyMode, startedAt: new Date().toISOString(), restrictions: ['no IndexFaces', 'no DeleteFaces', 'no pipeline/frontend/upload/threshold/architecture changes'] });
  await log('execution:start', { executionId, applyMode, approvedManifestSha });
  const preflightResult = await preflight(approved);
  if (!applyMode) {
    await writeJson('execution-manifest.json', { executionId, status: 'preflight_passed_no_mutations', approvedManifestSha, proposalSha: approved.proposalSha, applyMode, completedAt: new Date().toISOString(), preflight: preflightResult.result });
    await log('execution:preflight-only-complete');
    return;
  }

  const eventRows = approved.proposals.eventUpdates as Row[];
  const photographerRows = approved.proposals.photographerUpdates as Row[];
  const reconstructionRows = approved.proposals.photoFaceReconstruction as Row[];
  const before = { database: await auditDatabase(), awsFaces: (await listAwsFaces()).length };
  const eventResult = await runStage('event_updates', eventRows, applyEventBatch, eventRows.map((row) => row.productId), [...new Set(eventRows.map((row) => row.newEventId))]);
  await writeJson('execution-manifest.json', { executionId, status: 'event_updates_complete', approvedManifestSha, before, eventResult, updatedAt: new Date().toISOString() });
  const photographerResult = await runStage('photographer_updates', photographerRows, applyPhotographerBatch, photographerRows.map((row) => row.productId), [...new Set(photographerRows.map((row) => row.eventId))]);
  await writeJson('execution-manifest.json', { executionId, status: 'photographer_updates_complete', approvedManifestSha, before, eventResult, photographerResult, updatedAt: new Date().toISOString() });
  const currentAws = await listAwsFaces();
  const currentAwsMap = new Map<string, Row>(currentAws.map((row) => [String(row.faceId), row]));
  for (const row of reconstructionRows) {
    const face = currentAwsMap.get(String(row.faceId));
    if (!face || String(face.externalImageId) !== String(row.productId) || String(face.imageId) !== String(row.imageId)) throw new Error(`AWS changed before reconstruction: ${row.faceId}`);
  }
  const reconstructionResult = await runStage('photo_faces_reconstruction', reconstructionRows, (batch) => applyReconstructionBatch(batch, currentAwsMap), reconstructionRows.map((row) => row.productId), [...new Set(reconstructionRows.map((row) => row.eventId))]);
  const afterAws = await listAwsFaces();
  const after = { database: await auditDatabase(), awsFaces: afterAws.length };
  const finalAudit = {
    before,
    after,
    expected: approved.manifest.predictedAfter,
    awsCandidateFacesStillPresent: reconstructionRows.every((row) => afterAws.some((face) => face.faceId === row.faceId && face.externalImageId === row.productId)),
    allCheckpointsCompleted: eventResult.checkpoints === 14 && photographerResult.checkpoints === 340 && reconstructionResult.checkpoints === 16,
    duplicates: { faceIds: after.database.duplicate_face_ids, photoFacePairs: after.database.duplicate_photo_face_pairs },
    forbiddenAwsOperationsExecuted: [],
  };
  if (!finalAudit.awsCandidateFacesStillPresent || !finalAudit.allCheckpointsCompleted || Number(after.database.duplicate_face_ids) || Number(after.database.duplicate_photo_face_pairs)) throw new Error('Final audit safety gate failed.');
  await writeJson('final-audit.json', finalAudit);
  const finalManifest = { executionId, status: 'completed', approvedManifestSha, proposalSha: approved.proposalSha, applyMode, before, eventResult, photographerResult, reconstructionResult, finalAudit, completedAt: new Date().toISOString(), rollbackPlan: path.join(approvedDir, 'rollback-plan.json'), forbiddenOperationsExecuted: [] };
  await writeJson('execution-manifest.json', finalManifest);
  const finalContent = canonical(finalManifest);
  await fs.writeFile(path.join(outputDir, 'execution-manifest.sha256'), `${sha256(finalContent)}  execution-manifest.json\n`, 'utf8');
  await log('execution:complete', { eventCorrected: eventResult.corrected, photographerCorrected: photographerResult.corrected, photoFacesReconstructed: reconstructionResult.corrected, allCheckpointsCompleted: true });
}

main().catch(async (error: any) => {
  await log('execution:fatal', { name: error?.name || null, message: error?.message || String(error), stoppedImmediately: true }).catch(() => undefined);
  await writeJson('failure.json', { failedAt: new Date().toISOString(), name: error?.name || null, message: error?.message || String(error), stoppedImmediately: true }).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
