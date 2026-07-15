import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

const outputDir = path.resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || 'artifacts/face-recovery-phase3a');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const bucketApiBaseUrl = String(process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
const bucketToken = String(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '');
const bucket = String(process.env.MEDIA_BUCKET || process.env.BUCKET || '');
const publicMediaBase = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

type Product = Record<string, any>;
type Event = Record<string, any>;
type Photographer = Record<string, any>;
type FaceRow = Record<string, any>;
type StorageFile = Record<string, any>;

function aliases(value: unknown) {
  const source = String(value || '').trim();
  if (!source) return [];
  const output = new Set<string>([source]);
  try {
    const parsed = new URL(source);
    const decoded = decodeURIComponent(parsed.pathname);
    output.add(parsed.pathname);
    output.add(parsed.pathname.replace(/^\/+/, ''));
    output.add(decoded);
    output.add(decoded.replace(/^\/+/, ''));
    output.add(decoded.split('/').pop() || '');
  } catch {
    const decoded = decodeURIComponent(source);
    output.add(source.replace(/^\/+/, ''));
    output.add(decoded);
    output.add(decoded.replace(/^\/+/, ''));
    output.add(decoded.split(/[\\/]/).pop() || '');
  }
  return [...output].filter(Boolean);
}

function sourceUrl(product: Product) {
  const source = String(product.storagePath || product.url || '').trim();
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return source;
  return publicMediaBase ? `${publicMediaBase}/${encodeURI(source.replace(/^\/+/, ''))}` : null;
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

async function bucketRequest(pathname: string) {
  if (!bucketToken || !bucket) return null;
  const response = await fetch(`${bucketApiBaseUrl}${pathname}`, { headers: { 'X-API-Token': bucketToken } });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Bucket HTTP ${response.status}`);
  return payload;
}

async function listStorageFiles(): Promise<StorageFile[]> {
  if (!bucketToken || !bucket) return [];
  const first = await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=1&per_page=500`);
  const files = [...(first?.files || [])];
  const totalPages = Number(first?.pagination?.total_pages || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=500`);
    files.push(...(payload?.files || []));
  }
  return files.filter((file) => !file.deleted_at && file.status !== 'deleted' && file.storage_exists !== false);
}

async function listAwsFaces() {
  const faces: any[] = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) faces.push({
      faceId: face.FaceId || null,
      externalImageId: face.ExternalImageId || null,
      imageId: face.ImageId || null,
      confidence: face.Confidence ?? null,
      indexFacesModelVersion: face.IndexFacesModelVersion || null,
      createdAt: null,
      lastUsedAt: null,
    });
    nextToken = page.NextToken;
  } while (nextToken);
  return faces;
}

async function loadDatabase() {
  const [products, events, photographers, faces, supabaseStorage] = await Promise.all([
    pool.query(`select id, name, type, status, event, checkpoint, "eventId", "vendedorId", url, "storagePath", "fileHash", "fileSize", "uploadBatchId", "faceIndexStatus", "faceIndexAttempts", "faceIndexError", "createdAt", "updatedAt" from public.products order by id`),
    pool.query(`select id, name, "photographerId", slug, date, "createdAt" from public.events order by id`),
    pool.query(`select id, status, approved, "createdAt" from public.photographers order by id`),
    pool.query(`select id, face_id, image_id, event_id, photo_id, photographer_id, confidence, created_at from public.photo_faces order by face_id`),
    pool.query(`select id, bucket_id, name, metadata, created_at, updated_at from storage.objects where name is not null order by id`),
  ]);
  return { products: products.rows, events: events.rows, photographers: photographers.rows, faces: faces.rows, supabaseStorage: supabaseStorage.rows };
}

function matchStorage(product: Product, storageIndex: Map<string, StorageFile[]>) {
  const keys = new Set([...aliases(product.storagePath), ...aliases(product.url)]);
  const matches = new Map<string, StorageFile>();
  for (const key of keys) for (const file of storageIndex.get(key) || []) matches.set(String(file.file_id || file.url || file.stored_name), file);
  const candidates = [...matches.values()];
  const exact = candidates.find((file) => file.url === product.storagePath || file.url === product.url || file.stored_name === product.storagePath);
  const file = exact || (candidates.length === 1 ? candidates[0] : null);
  return { file, ambiguous: !exact && candidates.length > 1, candidates: candidates.length };
}

async function headProbe(product: Product) {
  const url = sourceUrl(product);
  if (!url) return { exists: false, status: null, size: null, checksum: null, error: 'unresolved_source' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (response.status === 405) response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    return {
      exists: response.ok,
      status: response.status,
      size: Number(response.headers.get('content-length') || 0) || null,
      checksum: response.headers.get('x-checksum-sha256') || response.headers.get('etag') || null,
      error: response.ok ? null : `http_${response.status}`,
    };
  } catch (error: any) {
    return { exists: false, status: null, size: null, checksum: null, error: String(error?.name || error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

function recoveryClass(score: number, safe: boolean, recoverable: boolean) {
  if (safe && score >= 95) return 'A_automatic_safe';
  if (recoverable && score >= 80) return 'B_automatic_high_confidence';
  if (recoverable) return 'C_manual_review';
  return 'D_not_recoverable';
}

async function writeJson(name: string, value: unknown) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION is required.');
  const startedAt = new Date().toISOString();
  const [{ products, events, photographers, faces, supabaseStorage }, awsFaces, providerStorageFiles] = await Promise.all([loadDatabase(), listAwsFaces(), listStorageFiles()]);
  const storageFiles: StorageFile[] = [
    ...providerStorageFiles.map((file) => ({ ...file, storageProvider: 'external_bucket', bucket: file.bucket || bucket })),
    ...supabaseStorage.map((object: any) => ({
      file_id: `supabase:${object.id}`,
      file_name: String(object.name || '').split('/').pop(),
      stored_name: object.name,
      url: null,
      size_bytes: Number(object.metadata?.size || object.metadata?.contentLength || 0),
      checksum_sha256: object.metadata?.checksum_sha256 || null,
      mime_type: object.metadata?.mimetype || null,
      created_at: object.created_at,
      updated_at: object.updated_at,
      storageProvider: 'supabase_storage',
      bucket: object.bucket_id,
    })),
  ];

  const productsById = new Map<string, Product>(products.map((row: Product) => [String(row.id), row]));
  const eventsById = new Map<string, Event>(events.map((row: Event) => [String(row.id), row]));
  const photographersById = new Map<string, Photographer>(photographers.map((row: Photographer) => [String(row.id), row]));
  const facesByPhoto = new Map<string, FaceRow[]>();
  const dbFaceById = new Map<string, FaceRow>();
  for (const face of faces) {
    dbFaceById.set(String(face.face_id), face);
    const current = facesByPhoto.get(String(face.photo_id)) || [];
    current.push(face);
    facesByPhoto.set(String(face.photo_id), current);
  }
  const awsByExternal = new Map<string, any[]>();
  for (const face of awsFaces) {
    const current = awsByExternal.get(String(face.externalImageId || '')) || [];
    current.push(face);
    awsByExternal.set(String(face.externalImageId || ''), current);
  }
  const storageIndex = new Map<string, StorageFile[]>();
  for (const file of storageFiles) {
    for (const key of new Set([...aliases(file.url), ...aliases(file.stored_name), ...aliases(file.file_name), ...aliases(file.file_id)])) {
      const current = storageIndex.get(key) || [];
      current.push(file);
      storageIndex.set(key, current);
    }
  }

  const photos = products.filter((row: Product) => row.type === 'IMG');
  const storageAudit = await mapConcurrent(photos as Product[], 12, async (product: Product) => {
    const matched = matchStorage(product, storageIndex);
    const probe = matched.file ? null : await headProbe(product);
    const exists = Boolean(matched.file) || Boolean(probe?.exists);
    const actualSize = matched.file ? Number(matched.file.size_bytes || 0) || null : probe?.size || null;
    const actualChecksum = matched.file?.checksum_sha256 || probe?.checksum || null;
    const sizeMatches = product.fileSize && actualSize ? Number(product.fileSize) === Number(actualSize) : null;
    const checksumMatches = product.fileHash && matched.file?.checksum_sha256 ? String(product.fileHash).toLowerCase() === String(matched.file.checksum_sha256).toLowerCase() : null;
    return {
      productId: product.id,
      source: product.storagePath || product.url || null,
      bucket: matched.file?.bucket || bucket || null,
      storageProvider: matched.file?.storageProvider || (probe?.exists ? 'public_url_probe' : null),
      storageKey: matched.file?.stored_name || matched.file?.file_name || product.storagePath || null,
      exists,
      ambiguousManifestMatch: matched.ambiguous,
      manifestCandidates: matched.candidates,
      sizeBytes: actualSize,
      expectedSizeBytes: product.fileSize ? Number(product.fileSize) : null,
      sizeMatches,
      checksum: actualChecksum,
      expectedChecksum: product.fileHash || null,
      checksumMatches,
      integrity: exists && sizeMatches !== false && checksumMatches !== false ? 'valid' : exists ? 'metadata_mismatch' : 'missing',
      probeStatus: probe?.status ?? null,
      error: probe?.error ?? null,
    };
  });
  const storageByProduct = new Map<string, (typeof storageAudit)[number]>(storageAudit.map((row) => [String(row.productId), row]));

  const indexedWithoutFaces = products.filter((product: Product) => product.faceIndexStatus === 'indexed' && !(facesByPhoto.get(String(product.id)) || []).length).map((product: Product) => {
    const aws = awsByExternal.get(String(product.id)) || [];
    const storage = storageByProduct.get(String(product.id));
    const event = eventsById.get(String(product.eventId || ''));
    const photographerExists = photographersById.has(String(product.vendedorId || ''));
    const eventValid = Boolean(event);
    const photographerMatchesEvent = Boolean(event && product.vendedorId && event.photographerId === product.vendedorId);
    let score = 0;
    if (aws.length) score += 40;
    if (storage?.exists) score += 20;
    if (eventValid) score += 15;
    if (photographerExists) score += 15;
    if (photographerMatchesEvent) score += 10;
    const safe = aws.length > 0 && eventValid && photographerExists && photographerMatchesEvent;
    const recoverable = aws.length > 0 || Boolean(storage?.exists);
    return {
      productId: product.id,
      eventId: product.eventId,
      photographerId: product.vendedorId,
      storageKey: storage?.storageKey || product.storagePath || product.url,
      awsFaces: aws.map((face) => ({ faceId: face.faceId, confidence: face.confidence })),
      awsFaceExists: aws.length > 0,
      storageExists: Boolean(storage?.exists),
      canRebuildWithoutReindex: aws.length > 0 && eventValid && photographerExists,
      confidencePercent: score,
      classification: recoveryClass(score, safe, recoverable),
      reasons: [!aws.length && 'aws_face_missing', !storage?.exists && 'storage_missing', !eventValid && 'event_missing_or_invalid', !photographerExists && 'photographer_missing_or_invalid', eventValid && !photographerMatchesEvent && 'event_photographer_mismatch'].filter(Boolean),
    };
  });

  const eventNameIndex = new Map<string, Event[]>();
  for (const event of events) {
    const key = `${event.photographerId || ''}\u0000${String(event.name || '').trim().toLowerCase()}`;
    const current = eventNameIndex.get(key) || [];
    current.push(event);
    eventNameIndex.set(key, current);
  }
  const batchEventIndex = new Map<string, Map<string, number>>();
  for (const product of products) {
    if (!product.uploadBatchId || !product.eventId || !product.vendedorId) continue;
    const key = `${product.vendedorId}\u0000${product.uploadBatchId}`;
    const counts = batchEventIndex.get(key) || new Map<string, number>();
    counts.set(String(product.eventId), (counts.get(String(product.eventId)) || 0) + 1);
    batchEventIndex.set(key, counts);
  }
  const eventIssues = products.flatMap((product: Product) => {
    const event = eventsById.get(String(product.eventId || ''));
    const missing = !product.eventId;
    const invalid = Boolean(product.eventId) && !event;
    const divergentPhotographer = Boolean(event && product.vendedorId && event.photographerId !== product.vendedorId);
    const divergentName = Boolean(event && product.event && String(event.name).trim().toLowerCase() !== String(product.event).trim().toLowerCase());
    if (!missing && !invalid && !divergentPhotographer && !divergentName) return [];
    const exactCandidates = eventNameIndex.get(`${product.vendedorId || ''}\u0000${String(product.event || '').trim().toLowerCase()}`) || [];
    const batchCounts = batchEventIndex.get(`${product.vendedorId || ''}\u0000${product.uploadBatchId || ''}`) || new Map<string, number>();
    const batchCandidate = [...batchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const candidateId = exactCandidates.length === 1 ? exactCandidates[0].id : batchCandidate;
    const confidence = exactCandidates.length === 1 ? 98 : batchCandidate ? 90 : event ? 65 : 20;
    return [{
      productId: product.id,
      currentEventId: product.eventId,
      eventName: product.event,
      photographerId: product.vendedorId,
      storageKey: storageByProduct.get(String(product.id))?.storageKey || product.storagePath || product.url,
      issueTypes: [missing && 'missing_event_id', invalid && 'invalid_event_id', divergentPhotographer && 'event_photographer_divergence', divergentName && 'event_name_divergence'].filter(Boolean),
      suggestedEventId: candidateId,
      confidencePercent: confidence,
      classification: confidence >= 95 ? 'A_automatic_safe' : confidence >= 85 ? 'B_automatic_high_confidence' : candidateId ? 'C_manual_review' : 'D_not_identifiable',
      evidence: { exactNameAndPhotographerCandidates: exactCandidates.map((row) => row.id), uploadBatchMajorityEventId: batchCandidate },
    }];
  });

  const batchPhotographerIndex = new Map<string, Map<string, number>>();
  for (const product of products) {
    if (!product.uploadBatchId || !product.vendedorId) continue;
    const counts = batchPhotographerIndex.get(String(product.uploadBatchId)) || new Map<string, number>();
    counts.set(String(product.vendedorId), (counts.get(String(product.vendedorId)) || 0) + 1);
    batchPhotographerIndex.set(String(product.uploadBatchId), counts);
  }
  const photographerIssues: any[] = [];
  for (const product of products) {
    const event = eventsById.get(String(product.eventId || ''));
    const missing = !product.vendedorId;
    const invalid = Boolean(product.vendedorId) && !photographersById.has(String(product.vendedorId));
    const divergent = Boolean(event && product.vendedorId && event.photographerId !== product.vendedorId);
    if (!missing && !invalid && !divergent) continue;
    const batchCandidate = [...(batchPhotographerIndex.get(String(product.uploadBatchId || '')) || new Map()).entries()].sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || null;
    const suggested = event?.photographerId || batchCandidate;
    const confidence = event?.photographerId ? 98 : batchCandidate ? 90 : 20;
    photographerIssues.push({ entity: 'product', productId: product.id, currentPhotographerId: product.vendedorId, eventId: product.eventId, suggestedPhotographerId: suggested, confidencePercent: confidence, issueTypes: [missing && 'missing_photographer_id', invalid && 'invalid_photographer_id', divergent && 'event_photographer_divergence'].filter(Boolean), classification: confidence >= 95 ? 'A_automatic_safe' : confidence >= 85 ? 'B_automatic_high_confidence' : suggested ? 'C_manual_review' : 'D_not_identifiable' });
  }
  for (const face of faces) {
    const product = productsById.get(String(face.photo_id));
    const event = eventsById.get(String(face.event_id));
    const missing = !face.photographer_id;
    const invalid = Boolean(face.photographer_id) && !photographersById.has(String(face.photographer_id));
    const divergentProduct = Boolean(face.photographer_id && product?.vendedorId && face.photographer_id !== product.vendedorId);
    const divergentEvent = Boolean(face.photographer_id && event?.photographerId && face.photographer_id !== event.photographerId);
    if (!missing && !invalid && !divergentProduct && !divergentEvent) continue;
    const suggested = product?.vendedorId && event?.photographerId === product.vendedorId ? product.vendedorId : product?.vendedorId || event?.photographerId || null;
    const confidence = product?.vendedorId && event?.photographerId === product.vendedorId ? 98 : suggested ? 75 : 20;
    photographerIssues.push({ entity: 'photo_face', faceId: face.face_id, productId: face.photo_id, eventId: face.event_id, currentPhotographerId: face.photographer_id, suggestedPhotographerId: suggested, confidencePercent: confidence, issueTypes: [missing && 'missing_photographer_id', invalid && 'invalid_photographer_id', divergentProduct && 'product_photographer_divergence', divergentEvent && 'event_photographer_divergence'].filter(Boolean), classification: confidence >= 95 ? 'A_automatic_safe' : suggested ? 'C_manual_review' : 'D_not_identifiable' });
  }

  const awsFaceIdCounts = new Map<string, number>();
  for (const face of awsFaces) awsFaceIdCounts.set(String(face.faceId), (awsFaceIdCounts.get(String(face.faceId)) || 0) + 1);
  const awsAudit = awsFaces.map((face) => {
    const db = dbFaceById.get(String(face.faceId));
    const product = productsById.get(String(face.externalImageId || db?.photo_id || ''));
    const event = db ? eventsById.get(String(db.event_id)) : product ? eventsById.get(String(product.eventId || '')) : null;
    const duplicate = (awsFaceIdCounts.get(String(face.faceId)) || 0) > 1;
    const dbLinkValid = Boolean(db && product && db.photo_id === product.id && db.event_id === product.eventId && db.photographer_id === product.vendedorId);
    let classification = 'valid';
    if (duplicate) classification = 'duplicate';
    else if (db && (!dbLinkValid || (face.externalImageId && face.externalImageId !== db.photo_id))) classification = 'inconsistent';
    else if (!db && product) classification = 'orphan';
    else if (!db) classification = 'without_reference';
    const storage = product ? storageByProduct.get(String(product.id)) : null;
    const risk = classification === 'valid' ? 'low' : classification === 'orphan' && product && storage?.exists && event ? 'low' : product ? 'medium' : 'high';
    return { ...face, collection: collectionId, classification, risk, databaseFaceExists: Boolean(db), productExists: Boolean(product), eventExists: Boolean(event), storageExists: Boolean(storage?.exists), possibleOrigin: product ? { productId: product.id, eventId: product.eventId, photographerId: product.vendedorId, storageKey: storage?.storageKey || product.storagePath || product.url } : null, creationDateNote: 'ListFaces does not expose creation date.', lastUseNote: 'ListFaces does not expose last-use data.' };
  });

  const productIntegrity = products.filter((product: Product) => product.faceIndexStatus === 'indexed').map((product: Product) => {
    const productFaces = facesByPhoto.get(String(product.id)) || [];
    const event = eventsById.get(String(product.eventId || ''));
    const photographerExists = photographersById.has(String(product.vendedorId || ''));
    const storage = storageByProduct.get(String(product.id));
    const violations = [!productFaces.length && 'missing_photo_faces', !product.eventId && 'missing_event_id', product.eventId && !event && 'invalid_event_id', !product.vendedorId && 'missing_photographer_id', product.vendedorId && !photographerExists && 'invalid_photographer_id', event && product.vendedorId && event.photographerId !== product.vendedorId && 'event_photographer_mismatch', !String(product.storagePath || product.url || '').trim() && 'missing_storage_key', !storage?.exists && 'storage_object_missing', productFaces.some((face) => face.event_id !== product.eventId) && 'photo_face_event_mismatch', productFaces.some((face) => face.photographer_id !== product.vendedorId) && 'photo_face_photographer_mismatch'].filter(Boolean);
    return { productId: product.id, violations };
  }).filter((row) => row.violations.length);

  const matrixItems = [...indexedWithoutFaces, ...eventIssues, ...photographerIssues];
  const matrixCounts = Object.fromEntries(['A_automatic_safe', 'B_automatic_high_confidence', 'C_manual_review', 'D_not_recoverable', 'D_not_identifiable'].map((group) => [group, matrixItems.filter((row: any) => row.classification === group).length]));
  const missingStorage = storageAudit.filter((row) => !row.exists);
  const storageMetadataMismatch = storageAudit.filter((row) => row.integrity === 'metadata_mismatch');
  const affected = new Set<string>();
  for (const row of indexedWithoutFaces) affected.add(`product:${row.productId}`);
  for (const row of eventIssues) affected.add(`product:${row.productId}`);
  for (const row of photographerIssues) affected.add(row.entity === 'product' ? `product:${row.productId}` : `face:${row.faceId}`);
  for (const row of awsAudit.filter((item) => item.classification !== 'valid')) affected.add(`face:${row.faceId}`);
  for (const row of missingStorage) affected.add(`product:${row.productId}`);

  const summary = {
    phase: '3A_read_only_audit', startedAt, completedAt: new Date().toISOString(), outputDir,
    readOnlyGuarantee: { databaseStatements: ['SELECT'], awsOperations: ['ListFaces'], storageOperations: ['GET list metadata', 'HEAD', 'GET Range fallback'], mutationsPerformed: 0 },
    inventory: {
      products: products.length,
      photos: photos.length,
      indexed: products.filter((row: Product) => row.faceIndexStatus === 'indexed').length,
      pending: products.filter((row: Product) => row.faceIndexStatus === 'pending').length,
      processing: products.filter((row: Product) => row.faceIndexStatus === 'processing').length,
      no_face: products.filter((row: Product) => row.faceIndexStatus === 'no_face').length,
      failed: products.filter((row: Product) => row.faceIndexStatus === 'failed').length,
      photo_faces: faces.length,
      awsFaces: awsFaces.length,
      storageObjects: storageFiles.length,
      externalBucketObjects: providerStorageFiles.length,
      supabaseStorageObjects: supabaseStorage.length,
      events: events.length,
      photographers: photographers.length,
    },
    indexedWithoutPhotoFaces: { total: indexedWithoutFaces.length, byClassification: Object.fromEntries(['A_automatic_safe', 'B_automatic_high_confidence', 'C_manual_review', 'D_not_recoverable'].map((group) => [group, indexedWithoutFaces.filter((row) => row.classification === group).length])) },
    aws: { byClassification: Object.fromEntries(['valid', 'orphan', 'duplicate', 'inconsistent', 'without_reference'].map((group) => [group, awsAudit.filter((row) => row.classification === group).length])) },
    events: { issues: eventIssues.length, byClassification: Object.fromEntries(['A_automatic_safe', 'B_automatic_high_confidence', 'C_manual_review', 'D_not_identifiable'].map((group) => [group, eventIssues.filter((row) => row.classification === group).length])) },
    photographers: { issues: photographerIssues.length, productIssues: photographerIssues.filter((row) => row.entity === 'product').length, photoFaceIssues: photographerIssues.filter((row) => row.entity === 'photo_face').length, byClassification: Object.fromEntries(['A_automatic_safe', 'B_automatic_high_confidence', 'C_manual_review', 'D_not_identifiable'].map((group) => [group, photographerIssues.filter((row) => row.classification === group).length])) },
    storage: { auditedPhotos: storageAudit.length, existing: storageAudit.filter((row) => row.exists).length, missing: missingStorage.length, metadataMismatch: storageMetadataMismatch.length, checksumAvailable: storageAudit.filter((row) => row.checksum).length, checksumCompared: storageAudit.filter((row) => row.checksumMatches !== null).length },
    integrity: { indexedViolations: productIntegrity.length, duplicateDatabaseFaceIds: faces.length - new Set(faces.map((row: FaceRow) => row.face_id)).size, duplicateAwsFaceIds: awsFaces.length - new Set(awsFaces.map((row) => row.faceId)).size, duplicatePhotoFacePairs: faces.length - new Set(faces.map((row: FaceRow) => `${row.photo_id}:${row.face_id}`)).size },
    reconciliationMatrix: matrixCounts,
    totals: { violationInstances: indexedWithoutFaces.length + awsAudit.filter((row) => row.classification !== 'valid').length + eventIssues.length + photographerIssues.length + missingStorage.length + storageMetadataMismatch.length, uniqueAffectedEntities: affected.size },
    limitations: ['AWS ListFaces does not expose face creation date.', 'AWS ListFaces does not expose last-use timestamps.', 'Storage checksum is classified as unavailable when neither the provider manifest nor product metadata provides a comparable digest.'],
  };

  await Promise.all([
    writeJson('summary.json', summary),
    writeJson('indexed-without-photo-faces.json', indexedWithoutFaces),
    writeJson('aws-faces-audit.json', awsAudit),
    writeJson('aws-orphans.json', awsAudit.filter((row) => row.classification === 'orphan' || row.classification === 'without_reference')),
    writeJson('event-issues.json', eventIssues),
    writeJson('photographer-issues.json', photographerIssues),
    writeJson('storage-audit.json', storageAudit),
    writeJson('integrity-violations.json', productIntegrity),
    writeJson('pending-products.json', products.filter((row: Product) => row.faceIndexStatus === 'pending').map((row: Product) => ({ productId: row.id, type: row.type, publicationStatus: row.status, eventId: row.eventId, photographerId: row.vendedorId, storage: storageByProduct.get(String(row.id)) || null, eligibleForValidatedPipeline: row.type === 'IMG' && row.status === 'published' && Boolean(row.eventId) && Boolean(row.vendedorId) && Boolean(storageByProduct.get(String(row.id))?.exists) }))),
  ]);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: any) => { console.error(JSON.stringify({ event: 'phase3a:fatal', message: error?.message || String(error) })); process.exitCode = 1; }).finally(() => pool.end());
