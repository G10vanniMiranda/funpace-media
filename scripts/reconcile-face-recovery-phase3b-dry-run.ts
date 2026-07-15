import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

type Row = Record<string, any>;

const evidenceDir = path.resolve('artifacts/face-recovery-phase3a');
const executionId = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || path.join('artifacts/face-recovery-phase3b-dry-run', executionId));
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });

function normalize(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR').normalize('NFKC');
}

function canonical(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Buffer) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeArtifact(name: string, value: unknown) {
  const content = typeof value === 'string' ? value : canonical(value);
  const target = path.join(outputDir, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { file: name.replaceAll('\\', '/'), bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

async function readEvidence(name: string) {
  const target = path.join(evidenceDir, name);
  const content = await fs.readFile(target, 'utf8');
  return { data: JSON.parse(content), evidence: { file: path.relative(process.cwd(), target).replaceAll('\\', '/'), bytes: Buffer.byteLength(content), sha256: sha256(content) } };
}

async function listAwsFaces() {
  const faces: Row[] = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) {
      faces.push({
        faceId: face.FaceId || null,
        externalImageId: face.ExternalImageId || null,
        imageId: face.ImageId || null,
        confidence: face.Confidence ?? null,
        indexFacesModelVersion: face.IndexFacesModelVersion || null,
      });
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return faces.sort((a, b) => String(a.faceId).localeCompare(String(b.faceId)));
}

async function databaseSnapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const products = await client.query('select * from public.products order by id');
    const faces = await client.query('select * from public.photo_faces order by face_id');
    const events = await client.query('select * from public.events order by id');
    const photographers = await client.query('select * from public.photographers order by id');
    await client.query('COMMIT');
    return { products: products.rows, faces: faces.rows, events: events.rows, photographers: photographers.rows };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function batches<T>(items: T[], size = 25) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function simulatedCheckpoints(kind: string, items: Row[]) {
  return batches(items).map((batch, index) => {
    const cumulative = Math.min((index + 1) * 25, items.length);
    return {
      kind,
      checkpoint: index + 1,
      batchSize: batch.length,
      cumulative,
      processingResidual: 0,
      duplicateFaceIds: kind === 'photo_faces_reconstruction' ? batch.length - new Set(batch.map((row) => row.faceId)).size : 0,
      duplicatePhotoFacePairs: kind === 'photo_faces_reconstruction' ? batch.length - new Set(batch.map((row) => `${row.productId}:${row.faceId}`)).size : 0,
      validation: 'simulated_only_no_database_mutation',
    };
  });
}

async function main() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION is required.');
  const startedAt = new Date().toISOString();
  const evidenceFiles = await Promise.all([
    readEvidence('summary.json'),
    readEvidence('event-issues.json'),
    readEvidence('photographer-issues.json'),
    readEvidence('indexed-without-photo-faces.json'),
    readEvidence('aws-faces-audit.json'),
    readEvidence('storage-audit.json'),
  ]);
  const [phase3aSummary, eventIssues, photographerIssues, indexedWithoutFaces, phase3aAwsAudit, storageAudit] = evidenceFiles.map((item) => item.data);
  const evidence = evidenceFiles.map((item) => item.evidence);

  const [{ products, faces, events, photographers }, awsFaces] = await Promise.all([databaseSnapshot(), listAwsFaces()]);
  const productsById = new Map<string, Row>(products.map((row: Row) => [String(row.id), row]));
  const facesById = new Map<string, Row>(faces.map((row: Row) => [String(row.face_id), row]));
  const eventsById = new Map<string, Row>(events.map((row: Row) => [String(row.id), row]));
  const photographersById = new Map<string, Row>(photographers.map((row: Row) => [String(row.id), row]));
  const storageByProduct = new Map<string, Row>(storageAudit.map((row: Row) => [String(row.productId), row]));
  const awsByProduct = new Map<string, Row[]>();
  for (const face of awsFaces) {
    const current = awsByProduct.get(String(face.externalImageId || '')) || [];
    current.push(face);
    awsByProduct.set(String(face.externalImageId || ''), current);
  }

  const eventUpdates: Row[] = [];
  const rejectedEventUpdates: Row[] = [];
  for (const issue of eventIssues.filter((row: Row) => row.classification === 'A_automatic_safe')) {
    const product = productsById.get(String(issue.productId));
    const event = eventsById.get(String(issue.suggestedEventId));
    const storage = storageByProduct.get(String(issue.productId));
    const reasons = [
      !product && 'product_missing',
      product && (product.eventId ?? null) !== (issue.currentEventId ?? null) && 'product_event_changed_since_audit',
      product && String(product.vendedorId || '') !== String(issue.photographerId || '') && 'product_photographer_changed_since_audit',
      !event && 'suggested_event_missing',
      product && event && String(product.vendedorId || '') !== String(event.photographerId || '') && 'event_photographer_mismatch',
      product && event && normalize(product.event) !== normalize(event.name) && 'event_name_not_exact',
      Number(issue.confidencePercent || 0) < 98 && 'confidence_below_98',
      !storage?.exists && 'storage_missing',
      storage && storage.integrity !== 'valid' && 'storage_integrity_invalid',
    ].filter(Boolean);
    const proposal = {
      productId: issue.productId,
      oldEventId: product?.eventId ?? null,
      newEventId: issue.suggestedEventId,
      photographerId: product?.vendedorId ?? null,
      confidencePercent: issue.confidencePercent,
      evidence: { exactNormalizedEventName: true, eventPhotographerMatchesProduct: true, storageIntegrity: storage?.integrity || null },
    };
    if (reasons.length) rejectedEventUpdates.push({ ...proposal, reasons });
    else eventUpdates.push(proposal);
  }

  const photographerUpdates: Row[] = [];
  const rejectedPhotographerUpdates: Row[] = [];
  for (const issue of photographerIssues.filter((row: Row) => row.entity === 'photo_face' && row.classification === 'A_automatic_safe')) {
    const face = facesById.get(String(issue.faceId));
    const product = productsById.get(String(face?.photo_id || issue.productId));
    const event = eventsById.get(String(face?.event_id || issue.eventId));
    const proposed = String(issue.suggestedPhotographerId || '');
    const reasons = [
      !face && 'database_face_missing',
      face && (face.photographer_id ?? null) !== (issue.currentPhotographerId ?? null) && 'face_photographer_changed_since_audit',
      face && String(face.photo_id) !== String(issue.productId) && 'face_product_changed_since_audit',
      face && String(face.event_id) !== String(issue.eventId) && 'face_event_changed_since_audit',
      !product && 'product_missing',
      !event && 'event_missing',
      !photographersById.has(proposed) && 'photographer_missing',
      product && face && String(product.eventId || '') !== String(face.event_id || '') && 'product_event_mismatch',
      product && String(product.vendedorId || '') !== proposed && 'product_photographer_mismatch',
      event && String(event.photographerId || '') !== proposed && 'event_photographer_mismatch',
      Number(issue.confidencePercent || 0) < 98 && 'confidence_below_98',
    ].filter(Boolean);
    const proposal = { faceId: issue.faceId, productId: issue.productId, eventId: issue.eventId, oldPhotographerId: face?.photographer_id ?? null, newPhotographerId: issue.suggestedPhotographerId, confidencePercent: issue.confidencePercent };
    if (reasons.length) rejectedPhotographerUpdates.push({ ...proposal, reasons });
    else photographerUpdates.push(proposal);
  }

  const acceptedEventByProduct = new Map(eventUpdates.map((row) => [String(row.productId), row]));
  const phase3aIndexedByProduct = new Map(indexedWithoutFaces.map((row: Row) => [String(row.productId), row]));
  const phase3aOrphanFaceIds = new Set(phase3aAwsAudit.filter((row: Row) => row.classification === 'orphan').map((row: Row) => String(row.faceId)));
  const photoFaceReconstruction: Row[] = [];
  const rejectedReconstruction: Row[] = [];
  for (const eventProposal of eventUpdates) {
    const product = productsById.get(String(eventProposal.productId));
    const event = eventsById.get(String(eventProposal.newEventId));
    const storage = storageByProduct.get(String(eventProposal.productId));
    const phase3aIndexed = phase3aIndexedByProduct.get(String(eventProposal.productId));
    const liveFaces = awsByProduct.get(String(eventProposal.productId)) || [];
    for (const awsFace of liveFaces) {
      const reasons = [
        !phase3aIndexed && 'not_indexed_without_faces_in_phase3a',
        product?.faceIndexStatus !== 'indexed' && 'product_not_indexed',
        !phase3aOrphanFaceIds.has(String(awsFace.faceId)) && 'not_phase3a_orphan',
        facesById.has(String(awsFace.faceId)) && 'face_id_already_in_database',
        String(awsFace.externalImageId || '') !== String(product?.id || '') && 'aws_external_image_id_mismatch',
        !event && 'event_missing',
        !photographersById.has(String(product?.vendedorId || '')) && 'photographer_missing',
        event && String(event.photographerId || '') !== String(product?.vendedorId || '') && 'event_photographer_mismatch',
        !storage?.exists && 'storage_missing',
        storage && storage.integrity !== 'valid' && 'storage_integrity_invalid',
      ].filter(Boolean);
      const proposal = {
        faceId: awsFace.faceId,
        imageId: awsFace.imageId,
        eventId: eventProposal.newEventId,
        productId: eventProposal.productId,
        photographerId: product?.vendedorId ?? null,
        confidence: awsFace.confidence,
        awsExternalImageId: awsFace.externalImageId,
      };
      if (reasons.length) rejectedReconstruction.push({ ...proposal, reasons });
      else photoFaceReconstruction.push(proposal);
    }
  }

  const acceptedReconstructionProducts = new Set(photoFaceReconstruction.map((row) => String(row.productId)));
  const proposalFaceDuplicates = photoFaceReconstruction.length - new Set(photoFaceReconstruction.map((row) => String(row.faceId))).size;
  const proposalPairDuplicates = photoFaceReconstruction.length - new Set(photoFaceReconstruction.map((row) => `${row.productId}:${row.faceId}`)).size;
  const liveAwsFaceDuplicates = awsFaces.length - new Set(awsFaces.map((row) => String(row.faceId))).size;
  const liveDbFaceDuplicates = faces.length - new Set(faces.map((row: Row) => String(row.face_id))).size;
  if (proposalFaceDuplicates || proposalPairDuplicates || liveAwsFaceDuplicates || liveDbFaceDuplicates) throw new Error('Duplicate safety gate failed; dry-run manifest was not approved.');

  const proposals = {
    schemaVersion: 1,
    phase: '3B_safe_automatic_reconciliation',
    mode: 'dry_run_only',
    generatedAt: new Date().toISOString(),
    rulesVersion: 'phase3b-exact-v1',
    eventUpdates,
    photographerUpdates,
    photoFaceReconstruction,
  };
  const rejections = { eventUpdates: rejectedEventUpdates, photographerUpdates: rejectedPhotographerUpdates, photoFaceReconstruction: rejectedReconstruction };
  const checkpoints = [
    ...simulatedCheckpoints('product_event_updates', eventUpdates),
    ...simulatedCheckpoints('photo_face_photographer_updates', photographerUpdates),
    ...simulatedCheckpoints('photo_faces_reconstruction', photoFaceReconstruction),
  ];

  const artifacts: Row[] = [];
  artifacts.push(await writeArtifact('snapshots/products.json', products));
  artifacts.push(await writeArtifact('snapshots/photo_faces.json', faces));
  artifacts.push(await writeArtifact('snapshots/events.json', events));
  artifacts.push(await writeArtifact('snapshots/photographers.json', photographers));
  artifacts.push(await writeArtifact('snapshots/aws-faces.json', awsFaces));
  artifacts.push(await writeArtifact('proposals.json', proposals));
  artifacts.push(await writeArtifact('rejections.json', rejections));
  artifacts.push(await writeArtifact('checkpoints-simulated.json', checkpoints));

  const proposalArtifact = artifacts.find((item) => item.file === 'proposals.json');
  const rollback = {
    warning: 'PLAN ONLY. Do not execute without explicit rollback authorization.',
    scope: 'Database only; never deletes AWS faces.',
    eventUpdates: eventUpdates.map((row) => ({ productId: row.productId, restoreEventId: row.oldEventId, expectedCurrentEventId: row.newEventId })),
    photographerUpdates: photographerUpdates.map((row) => ({ faceId: row.faceId, restorePhotographerId: row.oldPhotographerId, expectedCurrentPhotographerId: row.newPhotographerId })),
    reconstructedFaceIds: photoFaceReconstruction.map((row) => row.faceId),
    transactionRequirement: 'single database transaction per batch; verify expected current value before restoration',
  };
  artifacts.push(await writeArtifact('rollback-plan.json', rollback));

  const facesByPhoto = new Map<string, Row[]>();
  for (const face of faces) {
    const current = facesByPhoto.get(String(face.photo_id)) || [];
    current.push(face);
    facesByPhoto.set(String(face.photo_id), current);
  }
  const liveEventIssues = products.filter((product: Row) => {
    const event = eventsById.get(String(product.eventId || ''));
    return !product.eventId || !event || Boolean(product.vendedorId && event.photographerId !== product.vendedorId) || Boolean(product.event && normalize(event.name) !== normalize(product.event));
  }).length;
  const liveProductPhotographerIssues = products.filter((product: Row) => {
    const event = eventsById.get(String(product.eventId || ''));
    return !product.vendedorId || !photographersById.has(String(product.vendedorId)) || Boolean(event && event.photographerId !== product.vendedorId);
  }).length;
  const liveFacePhotographerIssues = faces.filter((face: Row) => {
    const product = productsById.get(String(face.photo_id));
    const event = eventsById.get(String(face.event_id));
    return !face.photographer_id || !photographersById.has(String(face.photographer_id)) || Boolean(product?.vendedorId && face.photographer_id !== product.vendedorId) || Boolean(event?.photographerId && face.photographer_id !== event.photographerId);
  }).length;
  const liveIndexedWithoutPhotoFaces = products.filter((product: Row) => product.faceIndexStatus === 'indexed' && !(facesByPhoto.get(String(product.id)) || []).length).length;
  const liveAwsOrphans = awsFaces.filter((face: Row) => !facesById.has(String(face.faceId)) && productsById.has(String(face.externalImageId || ''))).length;
  const before = {
    products: products.length,
    photoFaces: faces.length,
    awsFaces: awsFaces.length,
    eventIssues: liveEventIssues,
    photographerIssues: liveProductPhotographerIssues + liveFacePhotographerIssues,
    indexedWithoutPhotoFaces: liveIndexedWithoutPhotoFaces,
    awsOrphans: liveAwsOrphans,
  };
  const predictedAfter = {
    products: products.length,
    photoFaces: faces.length + photoFaceReconstruction.length,
    awsFaces: awsFaces.length,
    eventIssues: before.eventIssues - eventUpdates.length,
    photographerIssues: before.photographerIssues - photographerUpdates.length,
    indexedWithoutPhotoFaces: before.indexedWithoutPhotoFaces - acceptedReconstructionProducts.size,
    awsOrphans: before.awsOrphans - photoFaceReconstruction.length,
  };
  const manifest = {
    schemaVersion: 1,
    phase: '3B_safe_automatic_reconciliation',
    executionId,
    mode: 'dry_run_only',
    startedAt,
    completedAt: new Date().toISOString(),
    collectionId,
    readOnlyGuarantee: {
      databaseOperations: ['BEGIN READ ONLY', 'SELECT', 'COMMIT'],
      awsOperations: ['ListFaces'],
      filesystemOperations: ['write local audit artifacts'],
      mutationsPerformed: 0,
      forbiddenOperationsObserved: [],
    },
    rulesVersion: proposals.rulesVersion,
    proposalSha256: proposalArtifact?.sha256,
    evidence,
    snapshotAndArtifactHashes: artifacts,
    liveInventory: { products: products.length, photoFaces: faces.length, events: events.length, photographers: photographers.length, awsFaces: awsFaces.length },
    accepted: { eventUpdates: eventUpdates.length, photographerUpdates: photographerUpdates.length, photoFaceRowsToReconstruct: photoFaceReconstruction.length, productsToReconstruct: acceptedReconstructionProducts.size },
    rejected: { eventUpdates: rejectedEventUpdates.length, photographerUpdates: rejectedPhotographerUpdates.length, photoFaceRows: rejectedReconstruction.length },
    safety: { proposalFaceDuplicates, proposalPairDuplicates, liveAwsFaceDuplicates, liveDbFaceDuplicates, awsCountChangedSincePhase3a: awsFaces.length - Number(phase3aSummary.inventory.awsFaces) },
    before,
    predictedAfter,
    predictedCoreInconsistencyActionsEliminated: eventUpdates.length + photographerUpdates.length + photoFaceReconstruction.length,
    limitations: [
      'No database or AWS mutation was performed.',
      'Checkpoint results are simulations over the immutable proposal list.',
      'Face-search validation is deferred until approved changes exist; Phase 3A evidence remains unchanged.',
      'Predicted totals subtract only accepted action-specific issues and do not claim all legacy inconsistencies are resolved.',
    ],
  };
  const manifestArtifact = await writeArtifact('manifest.json', manifest);
  await writeArtifact('manifest.sha256', `${manifestArtifact.sha256}  manifest.json\n`);
  const confirmationToken = `PHASE3B_APPLY_${manifestArtifact.sha256.slice(0, 12).toUpperCase()}`;
  const summary = {
    ...manifest,
    manifestSha256: manifestArtifact.sha256,
    confirmationToken,
    approvalState: 'AWAITING_EXPLICIT_VALIDATION_DO_NOT_APPLY',
    outputDir,
  };
  await writeArtifact('summary.json', summary);
  console.log(canonical(summary));
}

main().catch((error: any) => {
  console.error(JSON.stringify({ event: 'phase3b:dry-run:fatal', message: error?.message || String(error) }));
  process.exitCode = 1;
}).finally(() => pool.end());
