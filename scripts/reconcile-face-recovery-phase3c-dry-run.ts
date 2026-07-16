import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

type Row = Record<string, any>;

const execFileAsync = promisify(execFile);
const executionId = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || path.join('artifacts/face-recovery-phase3c-dry-run', executionId));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const bucketApiBaseUrl = String(process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
const bucketToken = String(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '');
const bucket = String(process.env.MEDIA_BUCKET || process.env.BUCKET || '');

function canonical(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalize(value: unknown) { return String(value || '').trim().toLocaleLowerCase('pt-BR').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function chunks<T>(items: T[], size = 25) { const output: T[][] = []; for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size)); return output; }
function aliases(value: unknown) {
  const source = String(value || '').trim(); if (!source) return [];
  const values = new Set<string>([source]);
  try { const url = new URL(source); values.add(url.pathname); values.add(url.pathname.replace(/^\/+/, '')); values.add(decodeURIComponent(url.pathname)); values.add(decodeURIComponent(url.pathname).replace(/^\/+/, '')); values.add(decodeURIComponent(url.pathname).split('/').pop() || ''); }
  catch { values.add(source.replace(/^\/+/, '')); values.add(decodeURIComponent(source)); values.add(decodeURIComponent(source).split(/[\\/]/).pop() || ''); }
  return [...values].filter(Boolean);
}
function directoryOf(value: unknown) { const source = String(value || ''); try { const url = new URL(source); return url.pathname.split('/').slice(0, -1).join('/'); } catch { return source.split(/[\\/]/).slice(0, -1).join('/'); } }
function dateToken(value: unknown) { const match = String(value || '').match(/(?:^|\D)(\d{1,2})[\/-](\d{1,2})(?:\D|$)/); return match ? `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}` : null; }
function eventDateToken(event: Row | undefined) { if (!event?.date) return null; const date = new Date(event.date); return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }

async function writeArtifact(name: string, value: unknown) {
  const content = typeof value === 'string' ? value : canonical(value);
  const target = path.join(outputDir, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8');
  return { file: name.replaceAll('\\', '/'), bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

async function databaseSnapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const products = (await client.query('select * from public.products order by id')).rows;
    const faces = (await client.query('select * from public.photo_faces order by face_id')).rows;
    const events = (await client.query('select * from public.events order by id')).rows;
    const photographers = (await client.query('select * from public.photographers order by id')).rows;
    const supabaseStorage = (await client.query('select * from storage.objects where name is not null order by id')).rows;
    const databaseVersion = (await client.query('select version()')).rows[0]?.version || null;
    await client.query('COMMIT');
    return { products, faces, events, photographers, supabaseStorage, databaseVersion };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

async function listAwsFaces() {
  const rows: Row[] = []; let nextToken: string | undefined;
  do { const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken })); for (const face of page.Faces || []) rows.push({ faceId: face.FaceId || null, externalImageId: face.ExternalImageId || null, imageId: face.ImageId || null, confidence: face.Confidence ?? null, indexFacesModelVersion: face.IndexFacesModelVersion || null }); nextToken = page.NextToken; } while (nextToken);
  return rows.sort((a, b) => String(a.faceId).localeCompare(String(b.faceId)));
}

async function bucketRequest(pathname: string) {
  if (!bucketToken || !bucket) return null;
  const response = await fetch(`${bucketApiBaseUrl}${pathname}`, { headers: { 'X-API-Token': bucketToken } });
  const payload: any = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.message || payload?.error || `Bucket HTTP ${response.status}`); return payload;
}

async function listExternalStorage() {
  if (!bucketToken || !bucket) return [];
  const first = await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=1&per_page=500`); const files = [...(first?.files || [])]; const pages = Number(first?.pagination?.total_pages || 1);
  for (let page = 2; page <= pages; page += 1) files.push(...((await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=500`))?.files || []));
  return files.filter((file: Row) => !file.deleted_at && file.status !== 'deleted' && file.storage_exists !== false).map((file: Row) => ({ ...file, storageProvider: 'external_bucket', bucket: file.bucket || bucket }));
}

function storageIndex(files: Row[]) {
  const index = new Map<string, Row[]>();
  for (const file of files) for (const key of new Set([...aliases(file.url), ...aliases(file.stored_name), ...aliases(file.file_name), ...aliases(file.file_id)])) { const rows = index.get(key) || []; rows.push(file); index.set(key, rows); }
  return index;
}

function findStorage(product: Row, index: Map<string, Row[]>) {
  const matches = new Map<string, Row>();
  for (const key of new Set([...aliases(product.storagePath), ...aliases(product.url)])) for (const file of index.get(key) || []) matches.set(String(file.file_id || file.id || file.url || file.stored_name), file);
  const candidates = [...matches.values()]; const exact = candidates.find((file) => file.url === product.storagePath || file.url === product.url || file.stored_name === product.storagePath || file.name === product.storagePath); const file = exact || (candidates.length === 1 ? candidates[0] : null);
  const size = Number(file?.size_bytes || file?.metadata?.size || file?.metadata?.contentLength || 0) || null; const checksum = file?.checksum_sha256 || file?.metadata?.checksum_sha256 || null;
  return { exists: Boolean(file), ambiguous: !exact && candidates.length > 1, candidates: candidates.length, provider: file?.storageProvider || null, bucket: file?.bucket || file?.bucket_id || null, key: file?.stored_name || file?.name || null, directory: directoryOf(file?.url || file?.stored_name || product.storagePath || product.url), size, checksum, sizeMatches: product.fileSize && size ? Number(product.fileSize) === size : null, checksumMatches: product.fileHash && checksum ? String(product.fileHash).toLowerCase() === String(checksum).toLowerCase() : null };
}

function simulatedCheckpoints(kind: string, rows: Row[]) { return chunks(rows).map((batch, index) => ({ kind, checkpoint: index + 1, batchSize: batch.length, cumulative: Math.min((index + 1) * 25, rows.length), validation: 'simulated_only_no_mutation', duplicates: kind === 'photo_faces_reconstruction' ? batch.length - new Set(batch.map((row) => row.faceId)).size : 0 })); }

async function main() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION is required.');
  const startedAt = new Date().toISOString();
  const [{ products, faces, events, photographers, supabaseStorage, databaseVersion }, awsFaces, externalStorage] = await Promise.all([databaseSnapshot(), listAwsFaces(), listExternalStorage()]);
  const codeVersion = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }).then((result) => result.stdout.trim()).catch(() => null);
  const scriptContent = await fs.readFile(new URL(import.meta.url));
  const priorManifestSources = [
    'artifacts/face-recovery-phase3a/summary.json',
    'artifacts/face-recovery-phase3b-dry-run/2026-07-15T17-18-52-299Z/manifest.json',
    'artifacts/face-recovery-phase3b-execution/phase3b-20260715-approved-138395/execution-manifest-final.json',
  ];
  const priorManifests = await Promise.all(priorManifestSources.map(async (source) => { const content = await fs.readFile(path.resolve(source), 'utf8'); return { source, sha256: sha256(content), content: JSON.parse(content) }; }));
  const storageFiles = [...externalStorage, ...supabaseStorage.map((file: Row) => ({ ...file, file_id: `supabase:${file.id}`, stored_name: file.name, size_bytes: Number(file.metadata?.size || file.metadata?.contentLength || 0), checksum_sha256: file.metadata?.checksum_sha256 || null, storageProvider: 'supabase_storage', bucket: file.bucket_id }))];
  const storageByAlias = storageIndex(storageFiles);
  const productsById = new Map<string, Row>(products.map((row: Row) => [String(row.id), row]));
  const eventsById = new Map<string, Row>(events.map((row: Row) => [String(row.id), row]));
  const photographersById = new Map<string, Row>(photographers.map((row: Row) => [String(row.id), row]));
  const facesById = new Map<string, Row>(faces.map((row: Row) => [String(row.face_id), row]));
  const awsById = new Map<string, Row>(awsFaces.map((row: Row) => [String(row.faceId), row]));
  const facesByPhoto = new Map<string, Row[]>(); for (const face of faces) { const rows = facesByPhoto.get(String(face.photo_id)) || []; rows.push(face); facesByPhoto.set(String(face.photo_id), rows); }
  const productsByEvent = new Map<string, Row[]>(); for (const product of products) { const rows = productsByEvent.get(String(product.eventId || '')) || []; rows.push(product); productsByEvent.set(String(product.eventId || ''), rows); }
  const sortedByPhotographer = new Map<string, Row[]>(); for (const product of products) { const key = String(product.vendedorId || ''); const rows = sortedByPhotographer.get(key) || []; rows.push(product); sortedByPhotographer.set(key, rows); } for (const rows of sortedByPhotographer.values()) rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const storageAudit = products.map((product: Row) => ({ productId: product.id, ...findStorage(product, storageByAlias) }));
  const storageByProduct = new Map<string, Row>(storageAudit.map((row) => [String(row.productId), row]));
  const eventPhotographerUpdates: Row[] = []; const rejectedEventPhotographerInference: Row[] = [];
  for (const event of events.filter((row: Row) => !row.photographerId)) {
    const related = productsByEvent.get(String(event.id)) || [];
    const published = related.filter((row) => row.status === 'published');
    const indexed = related.filter((row) => row.faceIndexStatus === 'indexed' && (facesByPhoto.get(String(row.id)) || []).length > 0);
    const faceBearing = related.filter((row) => (facesByPhoto.get(String(row.id)) || []).length > 0);
    const candidates = [...new Set(published.map((row) => String(row.vendedorId || '')).filter(Boolean))];
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const conflicting = candidate ? related.filter((row) => String(row.vendedorId || '') !== candidate) : related;
    const candidatePhotographer = candidate ? photographersById.get(candidate) : null;
    const hardGates = {
      singlePublishedPhotographer: candidates.length === 1,
      minimumPublishedEvidence: published.length >= 100,
      allIndexedAgree: Boolean(candidate) && indexed.length >= 100 && indexed.every((row) => String(row.vendedorId) === candidate),
      allFaceBearingAgree: Boolean(candidate) && faceBearing.length >= 100 && faceBearing.every((row) => String(row.vendedorId) === candidate),
      conflictingRowsNonProduction: conflicting.length > 0 && conflicting.every((row) => row.status === 'removed' && row.faceIndexStatus === 'disabled' && !(facesByPhoto.get(String(row.id)) || []).length),
      exactAlbumAndCheckpoint: Boolean(candidate) && published.every((row) => normalize(row.event) === normalize(event.name) && String(row.checkpoint || '') === String(event.checkpoint || '')),
      storageValidForIndexed: indexed.every((row) => { const storage = storageByProduct.get(String(row.id)); return storage?.exists && !storage.ambiguous && storage.sizeMatches !== false && storage.checksumMatches !== false; }),
      candidatePhotographerValid: Boolean(candidatePhotographer && candidatePhotographer.approved === true && candidatePhotographer.status === 'active'),
      conflictingRowsPredateProductionSet: conflicting.length > 0 && indexed.length > 0 && conflicting.every((row) => new Date(row.createdAt).getTime() < Math.min(...indexed.map((item) => new Date(item.createdAt).getTime()))),
    };
    const allGates = Object.values(hardGates).every(Boolean);
    const proposal = { eventId: event.id, eventName: event.name, oldPhotographerId: null, newPhotographerId: candidate, policyConfidenceScore: allGates ? 99.9 : 98, confidenceMeaning: 'deterministic policy score, not statistical probability', evidence: { relatedProducts: related.length, publishedProducts: published.length, indexedProductsWithFaces: indexed.length, databaseFaces: faceBearing.reduce((total, row) => total + (facesByPhoto.get(String(row.id)) || []).length, 0), conflictingProducts: conflicting.length, conflictingStatusSummary: Object.fromEntries([...new Set(conflicting.map((row) => `${row.status}:${row.faceIndexStatus}`))].map((key) => [key, conflicting.filter((row) => `${row.status}:${row.faceIndexStatus}` === key).length])), hardGates } };
    if (allGates) eventPhotographerUpdates.push(proposal); else rejectedEventPhotographerInference.push({ ...proposal, reasons: Object.entries(hardGates).filter(([, passed]) => !passed).map(([gate]) => gate) });
  }

  const virtualEventPhotographer = new Map(events.map((event: Row) => [String(event.id), event.photographerId])); for (const row of eventPhotographerUpdates) virtualEventPhotographer.set(String(row.eventId), row.newPhotographerId);
  const exactEventNameIndex = new Map<string, Row[]>(); for (const event of events) { const rows = exactEventNameIndex.get(normalize(event.name)) || []; rows.push(event); exactEventNameIndex.set(normalize(event.name), rows); }
  const productEventUpdates: Row[] = []; const productEventSuggestions = new Map<string, Row>();
  for (const product of products.filter((row: Row) => !row.eventId || !eventsById.has(String(row.eventId)) || (virtualEventPhotographer.get(String(row.eventId)) && String(virtualEventPhotographer.get(String(row.eventId))) !== String(row.vendedorId)))) {
    const exactCandidates = exactEventNameIndex.get(normalize(product.event)) || [];
    const photographerRows = sortedByPhotographer.get(String(product.vendedorId || '')) || []; const position = photographerRows.findIndex((row) => row.id === product.id); const neighbors = photographerRows.slice(Math.max(0, position - 2), position).concat(photographerRows.slice(position + 1, position + 3));
    const neighborEvents = neighbors.map((row) => row.eventId).filter(Boolean); const neighborMajority = [...new Set(neighborEvents)].sort((a, b) => neighborEvents.filter((value) => value === b).length - neighborEvents.filter((value) => value === a).length)[0] || null;
    const candidates = events.map((event: Row) => {
      const evidence = { exactAlbumName: normalize(event.name) === normalize(product.event), exactPhotographer: String(virtualEventPhotographer.get(String(event.id)) || '') === String(product.vendedorId || ''), exactAlbumDate: Boolean(dateToken(product.event) && dateToken(product.event) === eventDateToken(event)), neighborAgreement: neighborMajority === event.id && neighborEvents.filter((value) => value === event.id).length >= 2, exactCheckpoint: Boolean(product.checkpoint && event.checkpoint && product.checkpoint === event.checkpoint), storageValid: Boolean(storageByProduct.get(String(product.id))?.exists && !storageByProduct.get(String(product.id))?.ambiguous), uploadBatchAgreement: Boolean(product.uploadBatchId && neighbors.filter((row) => row.uploadBatchId === product.uploadBatchId && row.eventId === event.id).length >= 2) };
      const score = Math.min(99.89, (evidence.exactAlbumName ? 40 : 0) + (evidence.exactPhotographer ? 20 : 0) + (evidence.exactAlbumDate ? 15 : 0) + (evidence.neighborAgreement ? 10 : 0) + (evidence.exactCheckpoint ? 5 : 0) + (evidence.storageValid ? 5 : 0) + (evidence.uploadBatchAgreement ? 5 : 0));
      return { eventId: event.id, eventName: event.name, score, evidence };
    }).sort((a, b) => b.score - a.score);
    const top = candidates[0] || null; const uniqueExact = exactCandidates.length === 1 ? exactCandidates[0] : null; const storage = storageByProduct.get(String(product.id));
    const automaticHardGates = { uniqueExactAlbum: Boolean(uniqueExact && top?.eventId === uniqueExact.id), exactPhotographer: Boolean(top?.evidence.exactPhotographer), exactDate: Boolean(top?.evidence.exactAlbumDate), twoNeighborAgreement: Boolean(top?.evidence.neighborAgreement), exactCheckpoint: Boolean(top?.evidence.exactCheckpoint), storageIntegrity: Boolean(storage?.exists && !storage.ambiguous && storage.sizeMatches !== false && storage.checksumMatches !== false), uploadBatchAgreement: Boolean(top?.evidence.uploadBatchAgreement) };
    const automatic = Object.values(automaticHardGates).every(Boolean);
    const suggestion = { productId: product.id, currentEventId: product.eventId, suggestedEventId: top?.eventId || null, suggestedEventName: top?.eventName || null, policyConfidenceScore: automatic ? 99.9 : Number(top?.score || 0), automatic, evidence: { storage: storage || null, album: product.event, photographerId: product.vendedorId, uploadBatchId: product.uploadBatchId, uploadedAt: product.createdAt, directory: directoryOf(product.storagePath || product.url), namePattern: String(product.name || '').replace(/\d+/g, '#'), neighbors: neighbors.map((row) => ({ productId: row.id, createdAt: row.createdAt, eventId: row.eventId, album: row.event })), topCandidates: candidates.slice(0, 3), automaticHardGates } };
    productEventSuggestions.set(String(product.id), suggestion); if (automatic) productEventUpdates.push({ productId: product.id, oldEventId: product.eventId ?? null, newEventId: top.eventId, policyConfidenceScore: 99.9, evidence: suggestion.evidence });
  }

  const virtualProductEvent = new Map(products.map((row: Row) => [String(row.id), row.eventId])); for (const row of productEventUpdates) virtualProductEvent.set(String(row.productId), row.newEventId);
  const photoFacePhotographerUpdates: Row[] = [];
  for (const face of faces.filter((row: Row) => !row.photographer_id)) {
    const product = productsById.get(String(face.photo_id)); const eventId = virtualProductEvent.get(String(face.photo_id)); const eventPhotographer = virtualEventPhotographer.get(String(eventId || '')); const aws = awsById.get(String(face.face_id)); const storage = storageByProduct.get(String(face.photo_id));
    const gates = { productExists: Boolean(product), eventMatchesProduct: String(face.event_id) === String(eventId), exactProductEventPhotographer: Boolean(product?.vendedorId && String(product.vendedorId) === String(eventPhotographer || '')), awsFaceMatchesProduct: Boolean(aws && String(aws.externalImageId) === String(face.photo_id)), storageIntegrity: Boolean(storage?.exists && !storage.ambiguous && storage.sizeMatches !== false && storage.checksumMatches !== false), neverOverwrite: face.photographer_id == null };
    if (Object.values(gates).every(Boolean)) photoFacePhotographerUpdates.push({ faceId: face.face_id, productId: face.photo_id, eventId: face.event_id, oldPhotographerId: null, newPhotographerId: product.vendedorId, policyConfidenceScore: 99.9, evidence: gates });
  }

  const productPhotographerUpdates: Row[] = [];
  const photoFaceReconstruction: Row[] = [];
  for (const aws of awsFaces.filter((row) => !facesById.has(String(row.faceId)))) {
    const product = productsById.get(String(aws.externalImageId || '')); if (!product) continue; const eventId = virtualProductEvent.get(String(product.id)); const eventPhotographer = virtualEventPhotographer.get(String(eventId || '')); const storage = storageByProduct.get(String(product.id));
    const gates = { productIndexed: product.faceIndexStatus === 'indexed', eventValid: Boolean(eventId && eventsById.has(String(eventId))), exactPhotographer: Boolean(product.vendedorId && String(product.vendedorId) === String(eventPhotographer || '')), storageIntegrity: Boolean(storage?.exists && !storage.ambiguous && storage.sizeMatches !== false && storage.checksumMatches !== false), faceAbsentDatabase: !facesById.has(String(aws.faceId)), awsExternalImageExact: String(aws.externalImageId) === String(product.id) };
    if (Object.values(gates).every(Boolean)) photoFaceReconstruction.push({ faceId: aws.faceId, imageId: aws.imageId, productId: product.id, eventId, photographerId: product.vendedorId, confidence: aws.confidence, externalImageId: aws.externalImageId, indexCollection: collectionId, indexModelVersion: aws.indexFacesModelVersion, policyConfidenceScore: 99.9, evidence: gates });
  }

  const proposedEventIds = new Set(productEventUpdates.map((row) => String(row.productId))); const proposedFacePhotographers = new Set(photoFacePhotographerUpdates.map((row) => String(row.faceId))); const proposedReconstructionProducts = new Set(photoFaceReconstruction.map((row) => String(row.productId)));
  const reviewProducts = products.filter((product: Row) => {
    const eventId = virtualProductEvent.get(String(product.id)); const event = eventsById.get(String(eventId || '')); const eventPhotographer = virtualEventPhotographer.get(String(eventId || '')); const eventIssue = !eventId || !event || (eventPhotographer && String(eventPhotographer) !== String(product.vendedorId)); const missingFaces = product.faceIndexStatus === 'indexed' && !(facesByPhoto.get(String(product.id)) || []).length && !proposedReconstructionProducts.has(String(product.id)); return (eventIssue && !proposedEventIds.has(String(product.id))) || missingFaces;
  });
  const manualReviewQueue = reviewProducts.map((product: Row) => {
    const suggestion = productEventSuggestions.get(String(product.id)); const aws = awsFaces.filter((face) => String(face.externalImageId) === String(product.id)); const storage = storageByProduct.get(String(product.id)); const eventId = virtualProductEvent.get(String(product.id)); const event = eventsById.get(String(eventId || '')); const eventPhotographer = virtualEventPhotographer.get(String(eventId || ''));
    return { productId: product.id, currentEventId: product.eventId, suggestedEventId: suggestion?.suggestedEventId || null, suggestedEventName: suggestion?.suggestedEventName || null, currentPhotographerId: product.vendedorId, suggestedPhotographerId: suggestion?.suggestedEventId ? virtualEventPhotographer.get(String(suggestion.suggestedEventId)) || null : null, reasons: [!eventId && 'missing_event_id', eventId && !event && 'invalid_event_id', eventPhotographer && String(eventPhotographer) !== String(product.vendedorId) && 'event_photographer_conflict', product.faceIndexStatus === 'indexed' && !(facesByPhoto.get(String(product.id)) || []).length && 'indexed_without_photo_faces'].filter(Boolean), evidence: suggestion?.evidence || { storage }, policyConfidenceScore: suggestion?.policyConfidenceScore || 0, decision: (suggestion?.policyConfidenceScore || 0) >= 98 ? 'suggest_only' : 'manual_review_required', photoLink: product.url || product.storagePath || null, album: product.event, storage, awsFaces: aws.map((face) => ({ faceId: face.faceId, imageId: face.imageId, confidence: face.confidence })), probableEvent: suggestion ? { eventId: suggestion.suggestedEventId, eventName: suggestion.suggestedEventName } : null };
  });
  const remainingFaceReviewQueue = faces.filter((face: Row) => !face.photographer_id && !proposedFacePhotographers.has(String(face.face_id))).map((face: Row) => ({ faceId: face.face_id, productId: face.photo_id, eventId: face.event_id, reason: 'photographer_inference_below_99_9', productPhotographerId: productsById.get(String(face.photo_id))?.vendedorId || null, eventPhotographerId: virtualEventPhotographer.get(String(face.event_id)) || null }));

  const proposals = { schemaVersion: 1, phase: '3C_intelligent_historical_reconciliation', mode: 'dry_run_only', rulesVersion: 'phase3c-multi-evidence-exact-v1', thresholdPolicyScore: 99.9, generatedAt: new Date().toISOString(), eventPhotographerUpdates, productEventUpdates, productPhotographerUpdates, photoFacePhotographerUpdates, photoFaceReconstruction };
  const checkpoints = [...simulatedCheckpoints('event_photographer_updates', eventPhotographerUpdates), ...simulatedCheckpoints('product_event_updates', productEventUpdates), ...simulatedCheckpoints('product_photographer_updates', productPhotographerUpdates), ...simulatedCheckpoints('photo_face_photographer_updates', photoFacePhotographerUpdates), ...simulatedCheckpoints('photo_faces_reconstruction', photoFaceReconstruction)];
  const artifacts: Row[] = [];
  for (const [name, value] of Object.entries({ products, photo_faces: faces, events, photographers, aws_faces: awsFaces, storage_objects: storageFiles, prior_manifests: priorManifests })) artifacts.push(await writeArtifact(`snapshots/${name}.json`, value));
  artifacts.push(await writeArtifact('storage-audit.json', storageAudit)); artifacts.push(await writeArtifact('proposals.json', proposals)); artifacts.push(await writeArtifact('rejected-event-photographer-inference.json', rejectedEventPhotographerInference)); artifacts.push(await writeArtifact('manual-review-queue.json', manualReviewQueue)); artifacts.push(await writeArtifact('manual-face-review-queue.json', remainingFaceReviewQueue)); artifacts.push(await writeArtifact('checkpoints-simulated.json', checkpoints));
  const proposalArtifact = artifacts.find((row) => row.file === 'proposals.json');
  const before = { products: products.length, photoFaces: faces.length, awsFaces: awsFaces.length, eventIssues: products.filter((product: Row) => { const event = eventsById.get(String(product.eventId || '')); return !product.eventId || !event || Boolean(event && event.photographerId !== product.vendedorId); }).length, photographerIssues: products.filter((product: Row) => { const event = eventsById.get(String(product.eventId || '')); return !product.vendedorId || !photographersById.has(String(product.vendedorId)) || Boolean(event && event.photographerId !== product.vendedorId); }).length + faces.filter((face: Row) => !face.photographer_id || String(productsById.get(String(face.photo_id))?.vendedorId || '') !== String(face.photographer_id || '')).length, indexedWithoutPhotoFaces: products.filter((product: Row) => product.faceIndexStatus === 'indexed' && !(facesByPhoto.get(String(product.id)) || []).length).length, awsOrphans: awsFaces.filter((face) => !facesById.has(String(face.faceId)) && productsById.has(String(face.externalImageId || ''))).length };
  const predictedAfter = { products: before.products, photoFaces: before.photoFaces + photoFaceReconstruction.length, awsFaces: before.awsFaces, eventIssues: before.eventIssues - eventPhotographerUpdates.reduce((total, row) => total + Number(row.evidence.relatedProducts - row.evidence.conflictingProducts || 0), 0) - productEventUpdates.length, photographerIssues: before.photographerIssues - photoFacePhotographerUpdates.length - productPhotographerUpdates.length - eventPhotographerUpdates.reduce((total, row) => total + Number(row.evidence.relatedProducts - row.evidence.conflictingProducts || 0), 0), indexedWithoutPhotoFaces: before.indexedWithoutPhotoFaces - proposedReconstructionProducts.size, awsOrphans: before.awsOrphans - photoFaceReconstruction.length };
  const rollback = { warning: 'PLAN ONLY; no mutation occurred.', eventPhotographerUpdates: eventPhotographerUpdates.map((row) => ({ eventId: row.eventId, restorePhotographerId: row.oldPhotographerId, expectedCurrentPhotographerId: row.newPhotographerId })), productEventUpdates: productEventUpdates.map((row) => ({ productId: row.productId, restoreEventId: row.oldEventId, expectedCurrentEventId: row.newEventId })), productPhotographerUpdates: [], photoFacePhotographerUpdates: photoFacePhotographerUpdates.map((row) => ({ faceId: row.faceId, restorePhotographerId: null, expectedCurrentPhotographerId: row.newPhotographerId })), reconstructedFaceIds: photoFaceReconstruction.map((row) => row.faceId), awsRollbackOperations: [] };
  artifacts.push(await writeArtifact('rollback-plan.json', rollback));
  const manifest = { schemaVersion: 1, phase: proposals.phase, executionId, mode: 'dry_run_only', startedAt, completedAt: new Date().toISOString(), rulesVersion: proposals.rulesVersion, thresholdPolicyScore: 99.9, proposalSha256: proposalArtifact?.sha256, environment: { databaseVersion, codeVersion, reconciliationScriptSha256: sha256(scriptContent), collectionId, storageBucket: bucket || null }, readOnlyGuarantee: { databaseOperations: ['BEGIN READ ONLY', 'SELECT', 'COMMIT'], awsOperations: ['ListFaces'], storageOperations: ['list metadata'], mutationsPerformed: 0, forbiddenOperationsExecuted: [] }, accepted: { eventPhotographerUpdates: eventPhotographerUpdates.length, productEventUpdates: productEventUpdates.length, productPhotographerUpdates: 0, photoFacePhotographerUpdates: photoFacePhotographerUpdates.length, photoFaceReconstruction: photoFaceReconstruction.length }, reviewQueue: { products: manualReviewQueue.length, faces: remainingFaceReviewQueue.length, suggestOnly: manualReviewQueue.filter((row) => row.decision === 'suggest_only').length, manualRequired: manualReviewQueue.filter((row) => row.decision === 'manual_review_required').length }, before, predictedAfter, simulatedCheckpoints: checkpoints.length, snapshotAndArtifactHashes: artifacts, limitations: ['Policy confidence is a deterministic evidence score, not a statistical probability.', 'No /api/face/search call is made during dry-run because no reconciled state exists yet.', 'Missing historical events are never created or approximated automatically.'] };
  const manifestArtifact = await writeArtifact('manifest.json', manifest); await writeArtifact('manifest.sha256', `${manifestArtifact.sha256}  manifest.json\n`); const confirmationToken = `PHASE3C_APPLY_${manifestArtifact.sha256.slice(0, 12).toUpperCase()}`;
  const summary = { ...manifest, manifestSha256: manifestArtifact.sha256, confirmationToken, approvalState: 'AWAITING_EXPLICIT_VALIDATION_DO_NOT_APPLY', outputDir };
  await writeArtifact('summary.json', summary); console.log(canonical(summary));
}

main().catch((error: any) => { console.error(JSON.stringify({ event: 'phase3c:dry-run:fatal', message: error?.message || String(error) })); process.exitCode = 1; }).finally(() => pool.end());
