import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

const sourcePhotoId = process.env.FACE_E2E_SOURCE_PHOTO_ID || '586ec7e8-889e-4010-ae59-73e98699e033';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const apiBaseUrl = String(process.env.VITE_API_URL || 'https://api.funpace.media').replace(/\/+$/, '');
const bucketApiUrl = String(process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
const bucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '';
const mediaBucket = process.env.MEDIA_BUCKET || process.env.BUCKET || '';
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

function assertConfig() {
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!bucketToken) missing.push('BUCKET_API_TOKEN');
  if (!mediaBucket) missing.push('MEDIA_BUCKET');
  if (!process.env.AWS_REGION) missing.push('AWS_REGION');
  if (!process.env.AWS_REKOGNITION_COLLECTION) missing.push('AWS_REKOGNITION_COLLECTION');
  if (missing.length) throw new Error(`Configuracao ausente: ${missing.join(', ')}`);
}

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders, ...(init.headers || {}) },
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(typeof data === 'string' ? data : data?.message || raw || `Supabase HTTP ${response.status}`);
  return { data, response };
}

async function insert(table, body) {
  const { data } = await rest(`${table}?select=*`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  return data[0];
}

async function patch(table, filter, body) {
  await rest(`${table}?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}

async function uploadTestImage(buffer, contentType, fileName) {
  const formData = new FormData();
  formData.set('bucket', mediaBucket);
  formData.set('arquivo', new Blob([buffer], { type: contentType }), fileName);
  const response = await fetch(`${bucketApiUrl}/upload`, {
    method: 'POST',
    headers: { 'X-API-Token': bucketToken },
    body: formData,
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) throw new Error(payload?.error || payload?.message || raw || `Bucket HTTP ${response.status}`);
  const url = payload?.url || payload?.publicUrl || payload?.public_url || payload?.file?.url || payload?.data?.url;
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Bucket nao retornou URL publica valida.');
  const verification = await fetch(url, { method: 'HEAD' });
  if (!verification.ok) throw new Error(`Objeto publicado nao confirmou leitura: HTTP ${verification.status}`);
  return { url, status: verification.status, contentLength: Number(verification.headers.get('content-length') || buffer.length) };
}

async function createTestIdentity() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `face-e2e-${suffix}@example.invalid`;
  const password = `E2E-${randomUUID()}-Aa9!`;
  const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: 'face-publication-e2e' } }),
  });
  const user = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !user?.id) throw new Error(user?.message || 'Nao foi possivel criar usuario E2E.');
  const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !session?.access_token) throw new Error(session?.error_description || 'Nao foi possivel autenticar usuario E2E.');
  return { userId: user.id, email, accessToken: session.access_token };
}

async function requestIndex(accessToken, productId, eventId) {
  const response = await fetch(`${apiBaseUrl}/api/face/index`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Photo-Id': productId, 'X-Event-Id': eventId },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error || `Face index HTTP ${response.status}`), { responseStatus: response.status, payload });
  return { httpStatus: response.status, ...payload };
}

async function productState(productId) {
  const { data } = await rest(`products?select=id,status,eventId,vendedorId,storagePath,faceIndexStatus,faceIndexAttempts,faceIndexErrorCode,faceIndexError,faceProcessingStartedAt,faceIndexedAt,faceProcessedAt&id=eq.${productId}&limit=1`);
  return data[0] || null;
}

async function runWithStatePolling(accessToken, productId, eventId) {
  const sequence = [];
  const initial = await productState(productId);
  sequence.push({ status: initial.faceIndexStatus, at: initial.createdAt || new Date().toISOString() });
  const request = requestIndex(accessToken, productId, eventId);
  let settled = false;
  request.finally(() => { settled = true; }).catch(() => undefined);
  for (let attempt = 0; attempt < 240 && !settled; attempt += 1) {
    const state = await productState(productId);
    if (state && sequence.at(-1)?.status !== state.faceIndexStatus) {
      sequence.push({ status: state.faceIndexStatus, at: new Date().toISOString() });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    const response = await request;
    const finalState = await productState(productId);
    if (sequence.at(-1)?.status !== finalState.faceIndexStatus) sequence.push({ status: finalState.faceIndexStatus, at: new Date().toISOString() });
    return { sequence, response, finalState };
  } catch (error) {
    const finalState = await productState(productId);
    if (sequence.at(-1)?.status !== finalState.faceIndexStatus) sequence.push({ status: finalState.faceIndexStatus, at: new Date().toISOString() });
    return { sequence, error: { message: error.message, httpStatus: error.responseStatus || null }, finalState };
  }
}

async function awsFacesForProduct(productId) {
  const faces = [];
  let nextToken;
  do {
    const response = await rekognition.send(new ListFacesCommand({
      CollectionId: process.env.AWS_REKOGNITION_COLLECTION,
      MaxResults: 4096,
      NextToken: nextToken,
    }));
    faces.push(...(response.Faces || []).filter((face) => face.ExternalImageId === productId));
    nextToken = response.NextToken;
  } while (nextToken);
  return faces.map((face) => ({
    faceId: face.FaceId,
    imageId: face.ImageId,
    externalImageId: face.ExternalImageId,
    confidence: face.Confidence,
  }));
}

async function searchTestEvent(selfieBuffer, eventId) {
  const sessionId = `face-e2e-${randomUUID()}`;
  const consent = await fetch(`${apiBaseUrl}/api/face/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, accepted: true }),
  });
  if (!consent.ok) throw new Error(`Consentimento E2E falhou: HTTP ${consent.status}`);
  const formData = new FormData();
  formData.set('eventId', eventId);
  formData.set('sessionId', sessionId);
  formData.set('selfie', new Blob([selfieBuffer], { type: 'image/jpeg' }), 'selfie-real-reference.jpg');
  const response = await fetch(`${apiBaseUrl}/api/face/search`, { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Face search HTTP ${response.status}`);
  return { httpStatus: response.status, matches: (payload.matches || []).map((match) => ({ productId: match.product?.id, eventId: match.product?.eventId, similarity: match.similarity })) };
}

async function pendingCount() {
  const { response } = await rest('products?select=id&status=eq.published&type=eq.IMG&faceIndexStatus=eq.pending', {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  return Number((response.headers.get('content-range') || '/0').split('/')[1]);
}

async function main() {
  assertConfig();
  const startedAt = new Date().toISOString();
  const baselinePending = await pendingCount();
  if (baselinePending < 1000) throw new Error(`Baseline de seguranca inesperado: ${baselinePending} pendentes; teste interrompido.`);

  const { data: sourceRows } = await rest(`products?select=id,storagePath,url&id=eq.${sourcePhotoId}&faceIndexStatus=eq.indexed&limit=1`);
  const source = sourceRows[0];
  if (!source) throw new Error('Foto de referencia indexada nao encontrada.');
  const sourceResponse = await fetch(source.storagePath || source.url);
  if (!sourceResponse.ok) throw new Error(`Download da referencia falhou: HTTP ${sourceResponse.status}`);
  const faceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
  const noFaceBuffer = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#f2f2f2' } }).jpeg({ quality: 90 }).toBuffer();

  const identity = await createTestIdentity();
  const photographer = await insert('photographers', {
    id: identity.userId,
    auth_user_id: identity.userId,
    name: 'Face E2E Production Validation',
    displayName: 'Face E2E Validation',
    email: identity.email,
    bio: 'Conta tecnica isolada para validacao E2E facial.',
    avatar: '',
    verified: true,
    approved: true,
    status: 'active',
    role: 'photographer',
    isPublic: false,
  });
  const event = await insert('events', {
    photographerId: photographer.id,
    name: `Face E2E Production ${Date.now()}`,
    slug: `face-e2e-${randomUUID()}`,
    description: 'Evento tecnico isolado para validacao E2E facial.',
    date: new Date().toISOString().slice(0, 10),
    location: 'Production E2E',
    isPublished: true,
    isFeatured: false,
    moderationStatus: 'approved',
    status: 'active',
  });

  const [faceStorage, noFaceStorage] = await Promise.all([
    uploadTestImage(faceBuffer, 'image/jpeg', `face-e2e-known-${Date.now()}.jpg`),
    uploadTestImage(noFaceBuffer, 'image/jpeg', `face-e2e-no-face-${Date.now()}.jpg`),
  ]);
  const commonProduct = { price: 1, type: 'IMG', vendedorId: photographer.id, bib: '', event: event.name, eventId: event.id, checkpoint: '', status: 'published', faceIndexStatus: 'pending', faceIndexAttempts: 0 };
  const knownProduct = await insert('products', { ...commonProduct, name: 'Face E2E Known', url: faceStorage.url, storagePath: faceStorage.url, fileSize: faceBuffer.length, originalFileName: 'face-e2e-known.jpg' });
  const noFaceProduct = await insert('products', { ...commonProduct, name: 'Face E2E No Face', url: noFaceStorage.url, storagePath: noFaceStorage.url, fileSize: noFaceBuffer.length, originalFileName: 'face-e2e-no-face.jpg' });
  const failedProduct = await insert('products', { ...commonProduct, name: 'Face E2E Controlled Failure', url: 'https://controlled-failure.invalid/face-e2e.jpg', storagePath: 'https://controlled-failure.invalid/face-e2e.jpg', originalFileName: 'face-e2e-controlled-failure.jpg' });

  const known = await runWithStatePolling(identity.accessToken, knownProduct.id, event.id);
  const dbFaceResponse = await rest(`photo_faces?select=face_id,image_id,event_id,photo_id,external_image_id,photographer_id,index_collection,index_model_version,confidence,created_at&photo_id=eq.${knownProduct.id}`);
  const dbFaces = dbFaceResponse.data;
  const awsFacesBeforeDuplicate = await awsFacesForProduct(knownProduct.id);
  const search = await searchTestEvent(faceBuffer, event.id);
  const duplicate = await requestIndex(identity.accessToken, knownProduct.id, event.id);
  const dbFacesAfterDuplicate = (await rest(`photo_faces?select=face_id&photo_id=eq.${knownProduct.id}`)).data;
  const awsFacesAfterDuplicate = await awsFacesForProduct(knownProduct.id);
  const noFace = await runWithStatePolling(identity.accessToken, noFaceProduct.id, event.id);
  const failed = await runWithStatePolling(identity.accessToken, failedProduct.id, event.id);
  const stuck = (await rest(`products?select=id,faceProcessingStartedAt&faceIndexStatus=eq.processing&faceProcessingStartedAt=lt.${encodeURIComponent(new Date(Date.now() - 15 * 60 * 1000).toISOString())}`)).data;
  const endingPending = await pendingCount();

  await patch('events', `id=eq.${event.id}`, { isPublished: false, status: 'closed', updatedAt: new Date().toISOString() });
  await patch('photographers', `id=eq.${photographer.id}`, { status: 'disabled', isPublic: false, updatedAt: new Date().toISOString() });

  console.log(JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    ids: { photographerId: photographer.id, eventId: event.id, knownProductId: knownProduct.id, noFaceProductId: noFaceProduct.id, failedProductId: failedProduct.id },
    storage: { known: { httpStatus: faceStorage.status, bytes: faceStorage.contentLength }, noFace: { httpStatus: noFaceStorage.status, bytes: noFaceStorage.contentLength } },
    known: { sequence: known.sequence, endpoint: known.response || known.error, finalState: known.finalState, awsFaces: awsFacesBeforeDuplicate, photoFaces: dbFaces },
    search,
    duplicate: { endpoint: duplicate, databaseRowsBefore: dbFaces.length, databaseRowsAfter: dbFacesAfterDuplicate.length, awsFacesBefore: awsFacesBeforeDuplicate.length, awsFacesAfter: awsFacesAfterDuplicate.length },
    noFace: { sequence: noFace.sequence, endpoint: noFace.response || noFace.error, finalState: noFace.finalState, photoFaceRows: (await rest(`photo_faces?select=face_id&photo_id=eq.${noFaceProduct.id}`)).data.length },
    controlledFailure: { sequence: failed.sequence, endpoint: failed.response || failed.error, finalState: failed.finalState, photoFaceRows: (await rest(`photo_faces?select=face_id&photo_id=eq.${failedProduct.id}`)).data.length },
    invariants: { baselinePending, endingPending, pendingLegacyUntouched: baselinePending === endingPending, processingOlderThan15Minutes: stuck.length },
    cleanup: { dataDeleted: false, eventUnpublished: true, testPhotographerDisabled: true },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ faceE2EFailed: true, message: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
