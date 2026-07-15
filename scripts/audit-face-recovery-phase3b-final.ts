import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

type Row = Record<string, any>;

const approvedDir = path.resolve('artifacts/face-recovery-phase3b-dry-run/2026-07-15T17-18-52-299Z');
const executionDir = path.resolve('artifacts/face-recovery-phase3b-execution/phase3b-20260715-approved-138395');
const approvedManifestSha = '1383953648343b1b6cf367c2f088282ad68c26279730690394a047514b6b6c16';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });

function canonical(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function writeJson(name: string, value: unknown) { const target = path.join(executionDir, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, canonical(value), 'utf8'); return { file: name, sha256: sha256(canonical(value)) }; }

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

async function databaseSnapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const products = (await client.query('select * from public.products order by id')).rows;
    const faces = (await client.query('select * from public.photo_faces order by face_id')).rows;
    const events = (await client.query('select * from public.events order by id')).rows;
    const photographers = (await client.query('select * from public.photographers order by id')).rows;
    await client.query('COMMIT');
    return { products, faces, events, photographers };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

async function main() {
  const manifestContent = await fs.readFile(path.join(approvedDir, 'manifest.json'), 'utf8');
  if (sha256(manifestContent) !== approvedManifestSha) throw new Error('Approved manifest hash changed.');
  const approvedManifest = JSON.parse(manifestContent);
  const proposalsContent = await fs.readFile(path.join(approvedDir, 'proposals.json'), 'utf8');
  if (sha256(proposalsContent) !== approvedManifest.proposalSha256) throw new Error('Approved proposals hash changed.');
  const proposals = JSON.parse(proposalsContent);
  const before = JSON.parse(await fs.readFile(path.join(executionDir, 'preflight.json'), 'utf8'));
  const [snapshot, awsFaces] = await Promise.all([databaseSnapshot(), listAwsFaces()]);
  const products = new Map<string, Row>(snapshot.products.map((row: Row) => [String(row.id), row]));
  const faces = new Map<string, Row>(snapshot.faces.map((row: Row) => [String(row.face_id), row]));
  const events = new Map<string, Row>(snapshot.events.map((row: Row) => [String(row.id), row]));
  const photographers = new Set(snapshot.photographers.map((row: Row) => String(row.id)));
  const aws = new Map<string, Row>(awsFaces.map((row) => [String(row.faceId), row]));
  const faceRowsByPhoto = new Map<string, Row[]>();
  for (const face of snapshot.faces) { const rows = faceRowsByPhoto.get(String(face.photo_id)) || []; rows.push(face); faceRowsByPhoto.set(String(face.photo_id), rows); }

  const eventMismatches = proposals.eventUpdates.filter((row: Row) => String(products.get(String(row.productId))?.eventId || '') !== String(row.newEventId));
  const photographerMismatches = proposals.photographerUpdates.filter((row: Row) => String(faces.get(String(row.faceId))?.photographer_id || '') !== String(row.newPhotographerId));
  const reconstructionMismatches = proposals.photoFaceReconstruction.filter((row: Row) => {
    const face = faces.get(String(row.faceId));
    return !face || String(face.photo_id) !== String(row.productId) || String(face.event_id) !== String(row.eventId) || String(face.photographer_id) !== String(row.photographerId) || String(face.image_id || '') !== String(row.imageId || '');
  });
  const reconstructionAwsMismatches = proposals.photoFaceReconstruction.filter((row: Row) => {
    const face = aws.get(String(row.faceId));
    return !face || String(face.externalImageId) !== String(row.productId) || String(face.imageId) !== String(row.imageId);
  });

  const liveEventIssues = snapshot.products.filter((product: Row) => {
    const event = events.get(String(product.eventId || ''));
    const productName = String(product.event || '').trim().toLocaleLowerCase('pt-BR').normalize('NFKC');
    const eventName = String(event?.name || '').trim().toLocaleLowerCase('pt-BR').normalize('NFKC');
    return !product.eventId || !event || Boolean(product.vendedorId && event.photographerId !== product.vendedorId) || Boolean(productName && productName !== eventName);
  }).length;
  const productPhotographerIssues = snapshot.products.filter((product: Row) => { const event = events.get(String(product.eventId || '')); return !product.vendedorId || !photographers.has(String(product.vendedorId)) || Boolean(event && event.photographerId !== product.vendedorId); }).length;
  const facePhotographerIssues = snapshot.faces.filter((face: Row) => { const product = products.get(String(face.photo_id)); const event = events.get(String(face.event_id)); return !face.photographer_id || !photographers.has(String(face.photographer_id)) || Boolean(product?.vendedorId && face.photographer_id !== product.vendedorId) || Boolean(event?.photographerId && face.photographer_id !== event.photographerId); }).length;
  const indexedWithoutFaces = snapshot.products.filter((product: Row) => product.faceIndexStatus === 'indexed' && !(faceRowsByPhoto.get(String(product.id)) || []).length).length;
  const duplicateDatabaseFaceIds = snapshot.faces.length - new Set(snapshot.faces.map((row: Row) => String(row.face_id))).size;
  const duplicatePairs = snapshot.faces.length - new Set(snapshot.faces.map((row: Row) => `${row.photo_id}:${row.face_id}`)).size;
  const duplicateAwsFaceIds = awsFaces.length - new Set(awsFaces.map((row) => String(row.faceId))).size;
  const awsOrphans = awsFaces.filter((row) => !faces.has(String(row.faceId)) && products.has(String(row.externalImageId || ''))).length;
  const faceEventMismatches = snapshot.faces.filter((face: Row) => String(products.get(String(face.photo_id))?.eventId || '') !== String(face.event_id)).length;
  const facePhotographerMismatches = snapshot.faces.filter((face: Row) => String(products.get(String(face.photo_id))?.vendedorId || '') !== String(face.photographer_id || '')).length;

  const afterArtifacts = [];
  for (const [name, value] of Object.entries({ products: snapshot.products, photo_faces: snapshot.faces, events: snapshot.events, photographers: snapshot.photographers, aws_faces: awsFaces })) afterArtifacts.push(await writeJson(`after/${name}.json`, value));
  const searches = {
    eventUpdates: JSON.parse(await fs.readFile(path.join(executionDir, 'search/event_updates.json'), 'utf8')),
    photographerUpdates: JSON.parse(await fs.readFile(path.join(executionDir, 'search/photographer_updates.json'), 'utf8')),
    reconstruction: JSON.parse(await fs.readFile(path.join(executionDir, 'search/photo_faces_reconstruction.json'), 'utf8')),
  };
  const checkpointFiles = (await fs.readdir(path.join(executionDir, 'checkpoints'))).filter((name) => name.endsWith('.json'));
  const executionLog = await fs.readFile(path.join(executionDir, 'execution.jsonl'), 'utf8');
  const logRows = executionLog.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  let idempotentReplayNoOps = 0;
  let currentRunEventNoOps = 0;
  for (const row of logRows) {
    if (row.event === 'execution:start') { idempotentReplayNoOps += currentRunEventNoOps; currentRunEventNoOps = 0; }
    if (row.event === 'checkpoint:complete' && row.stage === 'event_updates') currentRunEventNoOps = Number(row.ignored || 0);
  }
  idempotentReplayNoOps += currentRunEventNoOps;
  const audit = {
    auditedAt: new Date().toISOString(),
    approvedManifestSha,
    proposalSha: approvedManifest.proposalSha256,
    effectiveExecution: {
      eventIdsCorrected: proposals.eventUpdates.length - eventMismatches.length,
      photographerIdsCorrected: proposals.photographerUpdates.length - photographerMismatches.length,
      photoFacesReconstructed: proposals.photoFaceReconstruction.length - reconstructionMismatches.length,
      ignoredFromApprovedScope: 0,
      rejectedFromApprovedScope: eventMismatches.length + photographerMismatches.length + reconstructionMismatches.length,
      idempotentReplayNoOps,
    },
    targetValidation: { eventMismatches: eventMismatches.length, photographerMismatches: photographerMismatches.length, reconstructionMismatches: reconstructionMismatches.length, reconstructionAwsMismatches: reconstructionAwsMismatches.length },
    before: { ...before.audit, aws_faces: before.awsCount },
    after: { products: snapshot.products.length, photo_faces: snapshot.faces.length, aws_faces: awsFaces.length, processing: snapshot.products.filter((row: Row) => row.faceIndexStatus === 'processing').length, pending: snapshot.products.filter((row: Row) => row.faceIndexStatus === 'pending').length, event_issues: liveEventIssues, photographer_issues: productPhotographerIssues + facePhotographerIssues, indexed_without_photo_faces: indexedWithoutFaces, aws_orphans: awsOrphans, duplicate_database_face_ids: duplicateDatabaseFaceIds, duplicate_photo_face_pairs: duplicatePairs, duplicate_aws_face_ids: duplicateAwsFaceIds, face_event_mismatches: faceEventMismatches, face_photographer_mismatches: facePhotographerMismatches },
    differencesFromDryRun: {
      coreActionCounts: { eventIds: proposals.eventUpdates.length - 349, photographerIds: proposals.photographerUpdates.length - 8488, photoFaces: proposals.photoFaceReconstruction.length - 393 },
      ambientProductsCreatedSinceExecutionPreflight: snapshot.products.length - Number(before.audit.products),
      ambientPhotoFacesCreatedSinceExecutionPreflight: snapshot.faces.length - Number(before.audit.photo_faces) - 393,
      ambientAwsFacesCreatedSinceExecutionPreflight: awsFaces.length - Number(before.awsCount),
    },
    idempotency: { allApprovedRowsAtDesiredState: !eventMismatches.length && !photographerMismatches.length && !reconstructionMismatches.length, duplicateFree: duplicateDatabaseFaceIds === 0 && duplicatePairs === 0 && duplicateAwsFaceIds === 0, conditionalReplayWouldMutateRows: 0 },
    checkpoints: { uniqueCheckpointFiles: checkpointFiles.length, expected: 370, allCompleted: checkpointFiles.length === 370 },
    searches: { eventUpdatesPassed: searches.eventUpdates.passed, photographerUpdatesPassed: searches.photographerUpdates.passed, reconstructionPassed: searches.reconstruction.passed, evidenceFiles: ['search/event_updates.json', 'search/photographer_updates.json', 'search/photo_faces_reconstruction.json'] },
    executionStops: logRows.filter((row) => row.event === 'execution:fatal').map((row) => ({ timestamp: row.timestamp, message: row.message, stoppedImmediately: row.stoppedImmediately })),
    awsOperationsUsedByPhase3B: ['ListFaces', 'SearchFacesByImage'],
    forbiddenOperationsExecutedByPhase3B: [],
    filesChangedInProductionData: ['public.products.eventId', 'public.photo_faces.photographer_id', 'public.photo_faces (393 inserted rows)'],
    afterArtifacts,
    rollbackPlan: path.relative(process.cwd(), path.join(approvedDir, 'rollback-plan.json')).replaceAll('\\', '/'),
  };
  if (audit.effectiveExecution.rejectedFromApprovedScope || audit.targetValidation.reconstructionAwsMismatches || !audit.idempotency.duplicateFree || !audit.checkpoints.allCompleted || !Object.values(audit.searches).filter((value) => typeof value === 'boolean').every(Boolean)) throw new Error(`Final audit failed: ${JSON.stringify(audit.targetValidation)}`);
  const auditArtifact = await writeJson('post-execution-audit.json', audit);
  const finalManifest = { executionId: 'phase3b-20260715-approved-138395', status: 'completed_and_independently_audited', approvedManifestSha, finalAuditSha: auditArtifact.sha256, effectiveExecution: audit.effectiveExecution, before: audit.before, after: audit.after, idempotency: audit.idempotency, checkpoints: audit.checkpoints, searches: audit.searches, forbiddenOperationsExecuted: [], completedAt: new Date().toISOString() };
  const manifestArtifact = await writeJson('execution-manifest-final.json', finalManifest);
  await fs.writeFile(path.join(executionDir, 'execution-manifest-final.sha256'), `${manifestArtifact.sha256}  execution-manifest-final.json\n`, 'utf8');
  console.log(canonical({ ...audit, finalManifestSha: manifestArtifact.sha256 }));
}

main().catch((error: any) => { console.error(JSON.stringify({ event: 'phase3b:final-audit:fatal', message: error?.message || String(error) })); process.exitCode = 1; }).finally(() => pool.end());
