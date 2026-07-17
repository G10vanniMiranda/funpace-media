import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { processPhotoFaceIndex } from '../server/face/face-indexing.js';
import { assertLegacyFaceRecoveryLocked } from './legacy-face-recovery-lock.js';

assertLegacyFaceRecoveryLocked('validate-face-backfill-pilot');

const productIds = String(process.argv.find((arg) => arg.startsWith('--product-ids='))?.split('=').slice(1).join('=') || '')
  .split(',').map((id) => id.trim()).filter(Boolean);
if (productIds.length < 1 || productIds.length > 500) throw new Error('Provide between 1 and 500 UUIDs with --product-ids=.');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');
const apiBase = String(process.env.VITE_API_URL || 'https://api.funpace.media').replace(/\/+$/, '');

async function dbSnapshot() {
  const products = await pool.query(`
    select id, "eventId", "vendedorId", "storagePath", url, "faceIndexStatus", "faceIndexAttempts", "faceIndexError"
    from public.products where id = any($1::uuid[]) order by id
  `, [productIds]);
  const faces = await pool.query(`
    select face_id, photo_id, event_id, photographer_id from public.photo_faces
    where photo_id = any($1::uuid[]) order by photo_id, face_id
  `, [productIds]);
  const duplicates = await pool.query(`
    select photo_id, face_id, count(*)::int as count from public.photo_faces
    where photo_id = any($1::uuid[]) group by photo_id, face_id having count(*) > 1
  `, [productIds]);
  const processing = await pool.query(`select id from public.products where id = any($1::uuid[]) and "faceIndexStatus" = 'processing'`, [productIds]);
  return { products: products.rows, faces: faces.rows, duplicates: duplicates.rows, processing: processing.rows };
}

async function awsSnapshot() {
  const selected = new Set(productIds);
  const faces: Array<{ faceId: string; externalImageId: string }> = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) {
      if (face.FaceId && face.ExternalImageId && selected.has(face.ExternalImageId)) faces.push({ faceId: face.FaceId, externalImageId: face.ExternalImageId });
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return faces.sort((a, b) => a.faceId.localeCompare(b.faceId));
}

async function searchWithPilotFace(photo: any) {
  const source = String(photo.storagePath || photo.url || '');
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Pilot photo download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const sessionId = `face-backfill-pilot-${randomUUID()}`;
  const consent = await fetch(`${apiBase}/api/face/consent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, accepted: true }),
  });
  if (!consent.ok) throw new Error(`Consent endpoint failed: HTTP ${consent.status}`);
  const form = new FormData();
  form.set('eventId', photo.eventId);
  form.set('sessionId', sessionId);
  form.set('selfie', new Blob([buffer], { type: response.headers.get('content-type') || 'image/jpeg' }), 'pilot-face-query.jpg');
  const search = await fetch(`${apiBase}/api/face/search`, { method: 'POST', body: form });
  const payload: any = await search.json().catch(() => ({}));
  if (!search.ok) throw new Error(payload?.error || `Search endpoint failed: HTTP ${search.status}`);
  const matches = (payload.matches || []).map((match: any) => ({ productId: match.product?.id, eventId: match.product?.eventId, similarity: match.similarity }));
  return { querySource: 'original_pilot_photo_as_corresponding_face_image', queryProductId: photo.id, eventId: photo.eventId, httpStatus: search.status, expectedProductFound: matches.some((match: any) => match.productId === photo.id && match.eventId === photo.eventId), expectedMatch: matches.find((match: any) => match.productId === photo.id) || null, matches: matches.slice(0, 20) };
}

async function main() {
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION is required.');
  const beforeDb = await dbSnapshot();
  if (beforeDb.products.length !== productIds.length || beforeDb.products.some((photo) => photo.faceIndexStatus !== 'indexed')) throw new Error('All selected photos must be indexed before validation.');
  const beforeAws = await awsSnapshot();
  const reuseResults = [];
  for (const photo of beforeDb.products) {
    reuseResults.push({ productId: photo.id, ...(await processPhotoFaceIndex({ photoId: photo.id, eventId: photo.eventId, photographerId: photo.vendedorId })) });
  }
  const afterDb = await dbSnapshot();
  const afterAws = await awsSnapshot();
  const searches = [];
  for (const photo of beforeDb.products) searches.push(await searchWithPilotFace(photo));
  const searchValidation = {
    total: searches.length,
    passed: searches.filter((row) => row.httpStatus === 200 && row.expectedProductFound).length,
    allPassed: searches.every((row) => row.httpStatus === 200 && row.expectedProductFound),
  };
  console.log(JSON.stringify({
    event: 'backfill:pilot-validation', validatedAt: new Date().toISOString(),
    idempotency: {
      calls: reuseResults.length, allReused: reuseResults.every((row) => row.reused && row.status === 'indexed'),
      attemptsUnchanged: beforeDb.products.every((before) => afterDb.products.find((after) => after.id === before.id)?.faceIndexAttempts === before.faceIndexAttempts),
      dbFaceCountBefore: beforeDb.faces.length, dbFaceCountAfter: afterDb.faces.length,
      dbFaceIdsUnchanged: JSON.stringify(beforeDb.faces.map((row) => row.face_id)) === JSON.stringify(afterDb.faces.map((row) => row.face_id)),
      awsFaceCountBefore: beforeAws.length, awsFaceCountAfter: afterAws.length,
      awsFaceIdsUnchanged: JSON.stringify(beforeAws) === JSON.stringify(afterAws), reuseResults,
    },
    integrity: { duplicatePhotoFaceRows: afterDb.duplicates, processingRows: afterDb.processing, linksValid: afterDb.faces.every((face) => { const photo = afterDb.products.find((row) => row.id === face.photo_id); return photo && face.event_id === photo.eventId && face.photographer_id === photo.vendedorId; }) },
    searchValidation, searches,
  }, null, 2));
  if (!searchValidation.allPassed) process.exitCode = 2;
}

main().catch((error) => { console.error(JSON.stringify({ event: 'backfill:pilot-validation-fatal', name: error?.name, message: error?.message })); process.exitCode = 1; }).finally(() => pool.end());
