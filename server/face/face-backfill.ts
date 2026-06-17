import { uploadPrivateImage } from '../../src/services/aws/s3.service.js';
import { indexFaces, removeFaces } from '../../src/services/aws/rekognition.service.js';
import {
  getPendingFacePhotoCount,
  claimPendingFacePhotos,
  getPhotoFaces,
  replacePhotoFaces,
  resolvePhotoEventId,
  updatePhotoEventId,
  updatePhotoFaceStatus,
  type BackfillPhoto,
} from './face-repository.js';

export type FaceBackfillResult = {
  total: number;
  processed: number;
  indexed: number;
  noFace: number;
  failed: number;
};

const batchSize = 50;

function getBackfillConfig() {
  const maxImageBytes = Number(process.env.FACE_BACKFILL_MAX_IMAGE_BYTES || 30 * 1024 * 1024);
  const timeoutMs = Number(process.env.FACE_BACKFILL_DOWNLOAD_TIMEOUT_MS || 30_000);
  const concurrency = Number(process.env.FACE_BACKFILL_CONCURRENCY || 3);
  return {
    maxImageBytes: Number.isFinite(maxImageBytes) && maxImageBytes > 0 ? maxImageBytes : 30 * 1024 * 1024,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    concurrency: Math.min(10, Math.max(1, Number.isFinite(concurrency) ? concurrency : 3)),
  };
}

function originalMediaUrl(photo: BackfillPhoto) {
  const source = String(photo.storagePath || photo.url || '').trim();
  if (!source) throw new Error('Foto sem URL original configurada.');
  if (/^https?:\/\//i.test(source)) return source;
  const baseUrl = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('MEDIA_PUBLIC_BASE_URL não configurado para baixar a foto original.');
  return `${baseUrl}/${encodeURI(source.replace(/^\/+/, ''))}`;
}

async function downloadOriginalPhoto(photo: BackfillPhoto) {
  const config = getBackfillConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(originalMediaUrl(photo), { signal: controller.signal });
    if (!response.ok) throw new Error(`Download da foto falhou com HTTP ${response.status}.`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > config.maxImageBytes) throw new Error('Foto original excede o limite do backfill.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('Foto original vazia.');
    if (buffer.length > config.maxImageBytes) throw new Error('Foto original excede o limite do backfill.');
    const contentType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(contentType)) {
      throw new Error(`Formato original não suportado pelo Rekognition: ${contentType || 'desconhecido'}.`);
    }
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

async function processPhoto(photo: BackfillPhoto): Promise<'indexed' | 'no_face' | 'failed'> {
  const startedAt = Date.now();
  try {
    const eventId = await resolvePhotoEventId(photo);
    if (!eventId) throw new Error('Evento da foto não encontrado para indexação facial.');
    if (!photo.eventId) await updatePhotoEventId(photo.id, eventId);

    console.info('[face-backfill] photo:download:start', { photoId: photo.id, eventId });
    const image = await downloadOriginalPhoto(photo);
    console.info('[face-backfill] photo:download:done', { photoId: photo.id, bytes: image.buffer.length });

    const key = `face-index/events/${eventId}/photos/${photo.id}`;
    const object = await uploadPrivateImage({ key, ...image, metadata: { photoId: photo.id, eventId, source: 'backfill' } });
    const oldFaces = await getPhotoFaces(photo.id);
    await removeFaces(oldFaces.map((face) => face.face_id));
    const records = await indexFaces({ ...object, photoId: photo.id });
    await replacePhotoFaces({
      photoId: photo.id,
      eventId,
      faces: records.flatMap((record) => record.Face?.FaceId ? [{
        faceId: record.Face.FaceId,
        imageId: record.Face.ImageId,
        confidence: record.Face.Confidence,
      }] : []),
    });
    const status = records.length > 0 ? 'indexed' : 'no_face';
    await updatePhotoFaceStatus(photo.id, status);
    console.info('[face-backfill] photo:done', { photoId: photo.id, eventId, status, faces: records.length, processingMs: Date.now() - startedAt });
    return status;
  } catch (error: any) {
    const message = String(error?.message || 'Falha desconhecida no backfill facial.');
    await updatePhotoFaceStatus(photo.id, 'failed', message).catch(() => undefined);
    console.error('[face-backfill] photo:failed', { photoId: photo.id, name: error?.name, message, processingMs: Date.now() - startedAt });
    return 'failed';
  }
}

export async function runFaceBackfill(): Promise<FaceBackfillResult> {
  const startedAt = Date.now();
  const total = await getPendingFacePhotoCount();
  const photos = await claimPendingFacePhotos(batchSize);
  const result: FaceBackfillResult = { total, processed: 0, indexed: 0, noFace: 0, failed: 0 };
  const { concurrency } = getBackfillConfig();

  console.info('[face-backfill] batch:start', { totalPending: total, batchSize: photos.length, concurrency });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, photos.length) }, async () => {
    while (cursor < photos.length) {
      const photo = photos[cursor];
      cursor += 1;
      const status = await processPhoto(photo);
      result.processed += 1;
      if (status === 'indexed') result.indexed += 1;
      else if (status === 'no_face') result.noFace += 1;
      else result.failed += 1;
      console.info('[face-backfill] batch:progress', { ...result, remainingInBatch: photos.length - result.processed });
    }
  });
  await Promise.all(workers);
  console.info('[face-backfill] batch:done', { ...result, processingMs: Date.now() - startedAt });
  return result;
}
