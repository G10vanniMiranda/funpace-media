import type { FaceRecord } from '@aws-sdk/client-rekognition';
import { uploadPrivateImage } from '../../src/services/aws/s3.service.js';
import {
  getCollectionMetadata,
  getRekognitionConfig,
  indexFaces,
  listFacesByExternalImageId,
  removeFaces,
} from '../../src/services/aws/rekognition.service.js';
import {
  claimPhotoFaceIndex,
  completePhotoFaceIndex,
  failPhotoFaceIndex,
  getEvent,
  getOwnedPhoto,
  getPhotoFaces,
} from './face-repository.js';

export type FaceIndexResult = {
  status: 'processing' | 'indexed' | 'no_face';
  facesIndexed: number;
  attempt: number;
  reused: boolean;
};

type FaceIndexDependencies = {
  getOwnedPhoto: typeof getOwnedPhoto;
  getEvent: typeof getEvent;
  getPhotoFaces: typeof getPhotoFaces;
  claimPhotoFaceIndex: typeof claimPhotoFaceIndex;
  completePhotoFaceIndex: typeof completePhotoFaceIndex;
  failPhotoFaceIndex: typeof failPhotoFaceIndex;
  uploadPrivateImage: typeof uploadPrivateImage;
  indexFaces: typeof indexFaces;
  listFacesByExternalImageId: typeof listFacesByExternalImageId;
  removeFaces: typeof removeFaces;
  getRekognitionConfig: typeof getRekognitionConfig;
  getCollectionMetadata: typeof getCollectionMetadata;
  fetch: typeof fetch;
};

const defaultDependencies: FaceIndexDependencies = {
  getOwnedPhoto,
  getEvent,
  getPhotoFaces,
  claimPhotoFaceIndex,
  completePhotoFaceIndex,
  failPhotoFaceIndex,
  uploadPrivateImage,
  indexFaces,
  listFacesByExternalImageId,
  removeFaces,
  getRekognitionConfig,
  getCollectionMetadata,
  fetch,
};

function safeErrorCode(error: any) {
  return String(error?.name || error?.code || 'FaceIndexError').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120) || 'FaceIndexError';
}

function safeErrorMessage(error: any) {
  return String(error?.message || 'Falha desconhecida na indexacao facial.').slice(0, 1000);
}

function sourceUrl(photo: { storagePath: string | null; url: string }) {
  const source = String(photo.storagePath || photo.url || '').trim();
  if (!source) throw Object.assign(new Error('Foto sem URL ou chave de storage configurada.'), { statusCode: 422 });
  if (/^https?:\/\//i.test(source)) return source;
  const baseUrl = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('MEDIA_PUBLIC_BASE_URL nao configurado para baixar a foto publicada.');
  return `${baseUrl}/${encodeURI(source.replace(/^\/+/, ''))}`;
}

async function downloadPublishedPhoto(photo: { storagePath: string | null; url: string }, request: typeof fetch) {
  const maxBytes = Number(process.env.FACE_INDEX_MAX_IMAGE_BYTES || process.env.FACE_BACKFILL_MAX_IMAGE_BYTES || 30 * 1024 * 1024);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.FACE_INDEX_DOWNLOAD_TIMEOUT_MS || 30_000));
  try {
    const response = await request(sourceUrl(photo), { signal: controller.signal });
    if (!response.ok) throw new Error(`Download da foto publicada falhou com HTTP ${response.status}.`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) throw Object.assign(new Error('Foto publicada excede o limite da indexacao facial.'), { statusCode: 413 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw Object.assign(new Error('Foto publicada vazia.'), { statusCode: 422 });
    if (buffer.length > maxBytes) throw Object.assign(new Error('Foto publicada excede o limite da indexacao facial.'), { statusCode: 413 });
    const contentType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(contentType)) {
      throw Object.assign(new Error(`Formato da foto publicada nao suportado: ${contentType || 'desconhecido'}.`), { statusCode: 415 });
    }
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

function validFaces(records: FaceRecord[]) {
  return records.flatMap((record) => record.Face?.FaceId ? [{
    faceId: record.Face.FaceId,
    imageId: record.Face.ImageId,
    confidence: record.Face.Confidence,
  }] : []);
}

export async function processPhotoFaceIndex(
  input: { photoId: string; eventId: string; photographerId: string },
  dependencies: FaceIndexDependencies = defaultDependencies,
): Promise<FaceIndexResult> {
  const startedAt = Date.now();
  const context = { productId: input.photoId, eventId: input.eventId, photographerId: input.photographerId };
  const photo = await dependencies.getOwnedPhoto(input.photoId, input.photographerId);
  if (!photo || photo.type !== 'IMG' || photo.status !== 'published') {
    throw Object.assign(new Error('Foto publicada nao encontrada para este fotografo.'), { statusCode: 404 });
  }
  if (photo.eventId !== input.eventId) {
    throw Object.assign(new Error('A foto nao pertence ao evento informado.'), { statusCode: 409 });
  }
  const event = await dependencies.getEvent(input.eventId);
  if (!event?.id || event.photographerId !== input.photographerId) {
    throw Object.assign(new Error('Evento nao pertence a este fotografo.'), { statusCode: 403 });
  }

  const existingFaces = await dependencies.getPhotoFaces(input.photoId);
  if (photo.faceIndexStatus === 'indexed' && existingFaces.length > 0 && existingFaces.every((face) => face.event_id === input.eventId)) {
    console.info('[face-index] request:reused', { ...context, status: 'indexed', faces: existingFaces.length, attempt: photo.faceIndexAttempts || 0 });
    return { status: 'indexed', facesIndexed: existingFaces.length, attempt: photo.faceIndexAttempts || 0, reused: true };
  }
  if (photo.faceIndexStatus === 'no_face') {
    console.info('[face-index] request:reused', { ...context, status: 'no_face', faces: 0, attempt: photo.faceIndexAttempts || 0 });
    return { status: 'no_face', facesIndexed: 0, attempt: photo.faceIndexAttempts || 0, reused: true };
  }

  const claimed = await dependencies.claimPhotoFaceIndex(input);
  if (!claimed?.faceIndexRunId) {
    const current = await dependencies.getOwnedPhoto(input.photoId, input.photographerId);
    const currentFaces = await dependencies.getPhotoFaces(input.photoId);
    if (current?.faceIndexStatus === 'indexed' && currentFaces.length > 0) {
      return { status: 'indexed', facesIndexed: currentFaces.length, attempt: current.faceIndexAttempts || 0, reused: true };
    }
    if (current?.faceIndexStatus === 'no_face') {
      return { status: 'no_face', facesIndexed: 0, attempt: current.faceIndexAttempts || 0, reused: true };
    }
    console.info('[face-index] request:in-progress', { ...context, statusPrevious: photo.faceIndexStatus, statusNew: 'processing' });
    return { status: 'processing', facesIndexed: 0, attempt: current?.faceIndexAttempts || photo.faceIndexAttempts || 0, reused: true };
  }

  const runId = claimed.faceIndexRunId;
  const attempt = claimed.faceIndexAttempts || 1;
  let createdFaceIds: string[] = [];
  console.info('[face-index] processing:start', {
    ...context,
    runId,
    attempt,
    statusPrevious: photo.faceIndexStatus,
    statusNew: 'processing',
  });

  try {
    const config = dependencies.getRekognitionConfig();
    let records: FaceRecord[] = [];
    if (attempt > 1) {
      const previousFaceIds = new Set(existingFaces.map((face) => face.face_id));
      records = (await dependencies.listFacesByExternalImageId(input.photoId))
        .filter((record) => record.Face?.FaceId && !previousFaceIds.has(record.Face.FaceId));
      if (records.length > 0) {
        console.info('[face-index] aws:existing-faces-recovered', { ...context, runId, attempt, faces: records.length });
      }
    }
    if (records.length === 0) {
      const image = await downloadPublishedPhoto(claimed, dependencies.fetch);
      const key = `face-index/events/${input.eventId}/photos/${input.photoId}`;
      const object = await dependencies.uploadPrivateImage({ key, ...image, metadata: {
        photoId: input.photoId,
        eventId: input.eventId,
        photographerId: input.photographerId,
        source: 'publication',
      } });
      records = await dependencies.indexFaces({ ...object, photoId: input.photoId });
      createdFaceIds = validFaces(records).map((face) => face.faceId);
    }

    const faces = validFaces(records);
    const metadata = await dependencies.getCollectionMetadata();
    const completed = await dependencies.completePhotoFaceIndex({
      ...input,
      runId,
      collectionId: config.collectionId,
      modelVersion: metadata.faceModelVersion,
      faces,
    });
    if (!completed) throw new Error('Claim facial expirou antes da persistencia dos FaceIds.');
    const status = faces.length > 0 ? 'indexed' : 'no_face';
    const persistedFaceIds = new Set(faces.map((face) => face.faceId));
    const supersededFaceIds = existingFaces.map((face) => face.face_id).filter((faceId) => !persistedFaceIds.has(faceId));
    if (supersededFaceIds.length > 0) {
      await dependencies.removeFaces(supersededFaceIds).catch((cleanupError: any) => {
        console.error('[face-index] aws:superseded-cleanup-failed', {
          ...context,
          runId,
          attempt,
          faces: supersededFaceIds.length,
          errorCode: safeErrorCode(cleanupError),
        });
      });
    }
    console.info('[face-index] processing:done', {
      ...context,
      runId,
      attempt,
      statusPrevious: 'processing',
      statusNew: status,
      facesReturned: records.length,
      faceIdsPersisted: faces.length,
      processingMs: Date.now() - startedAt,
    });
    return { status, facesIndexed: faces.length, attempt, reused: records.length > 0 && createdFaceIds.length === 0 };
  } catch (error: any) {
    if (createdFaceIds.length > 0) {
      await dependencies.removeFaces(createdFaceIds).catch((cleanupError: any) => {
        console.error('[face-index] aws:rollback-failed', { ...context, runId, attempt, errorCode: safeErrorCode(cleanupError) });
      });
    }
    const errorCode = safeErrorCode(error);
    const errorMessage = safeErrorMessage(error);
    await dependencies.failPhotoFaceIndex({ photoId: input.photoId, runId, errorCode, errorMessage }).catch(() => undefined);
    console.error('[face-index] processing:failed', {
      ...context,
      runId,
      attempt,
      statusPrevious: 'processing',
      statusNew: 'failed',
      errorCode,
      error: errorMessage,
      processingMs: Date.now() - startedAt,
    });
    throw error;
  }
}
