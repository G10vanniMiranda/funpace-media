import { randomUUID } from 'node:crypto';
import { getClientIp } from '../shared/security.js';
import { deletePrivateObject, getAwsS3Config, testS3Connection, uploadPrivateImage } from '../../src/services/aws/s3.service.js';
import { getRekognitionConfig, indexFaces, removeFaces, searchFaces, testRekognitionConnection } from '../../src/services/aws/rekognition.service.js';
import { faceError, isUuid, parseSelfieMultipart, readJsonBody, readRequestBuffer, validateImage } from './face-utils.js';
import { runFaceBackfill } from './face-backfill.js';
import {
  createFaceSearchConsent,
  getAuthenticatedUser,
  getEvent,
  getMatchesByEvent,
  getOwnedPhoto,
  getPhotoFaces,
  hasValidFaceSearchConsent,
  replacePhotoFaces,
  updatePhotoFaceStatus,
} from './face-repository.js';

export async function indexPhotoHandler(req: any, res: any) {
  const photoId = String(req.headers?.['x-photo-id'] || '').trim();
  const eventId = String(req.headers?.['x-event-id'] || '').trim();
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  const authUser = await getAuthenticatedUser(req);

  if (!authUser?.id) return res.status(401).json({ error: 'Autenticação de fotógrafo necessária.' });
  if (!isUuid(photoId) || !isUuid(eventId)) return res.status(400).json({ error: 'photoId ou eventId invalido.' });

  const photo = await getOwnedPhoto(photoId, authUser.id);
  if (!photo || photo.type !== 'IMG') return res.status(404).json({ error: 'Foto não encontrada para este fotógrafo.' });
  if (photo.eventId !== eventId) return res.status(409).json({ error: 'A foto não pertence ao evento informado.' });
  const event = await getEvent(eventId);
  if (!event?.id || event.photographerId !== authUser.id) return res.status(403).json({ error: 'Evento não pertence a este fotógrafo.' });

  try {
    const buffer = await readRequestBuffer(req);
    validateImage(buffer, contentType);
    await updatePhotoFaceStatus(photoId, 'processing');
    const key = `face-index/events/${eventId}/photos/${photoId}`;
    const object = await uploadPrivateImage({ key, buffer, contentType, metadata: { photoId, eventId } });
    const oldFaces = await getPhotoFaces(photoId);
    await removeFaces(oldFaces.map((face) => face.face_id));
    const records = await indexFaces({ ...object, photoId });
    await replacePhotoFaces({
      photoId,
      eventId,
      faces: records.flatMap((record) => record.Face?.FaceId ? [{
        faceId: record.Face.FaceId,
        imageId: record.Face.ImageId,
        confidence: record.Face.Confidence,
      }] : []),
    });
    await updatePhotoFaceStatus(photoId, records.length > 0 ? 'indexed' : 'no_face');
    return res.status(200).json({ status: records.length > 0 ? 'indexed' : 'no_face', facesIndexed: records.length });
  } catch (error: any) {
    const response = faceError(error, 'Não foi possível indexar a foto.');
    await updatePhotoFaceStatus(photoId, response.statusCode === 422 ? 'no_face' : 'failed', response.message).catch(() => undefined);
    console.error('[aws-rekognition] index:error', { photoId, eventId, name: error?.name, message: error?.message });
    return res.status(response.statusCode).json({ error: response.message });
  }
}

export async function searchFaceHandler(req: any, res: any) {
  const startedAt = Date.now();
  let selfieKey = '';
  try {
    const { eventId, sessionId, buffer, contentType } = await parseSelfieMultipart(req);
    if (!isUuid(eventId)) return res.status(400).json({ error: 'eventId invalido.' });
    if (!sessionId || !(await hasValidFaceSearchConsent(sessionId))) {
      console.warn('[face-consent] search:blocked', {
        eventId,
        hasSessionId: Boolean(sessionId),
        ip: getClientIp(req),
        userAgent: String(req.headers?.['user-agent'] || '').slice(0, 180),
      });
      return res.status(403).json({ error: 'Consentimento LGPD necessario para realizar a busca facial.' });
    }
    validateImage(buffer, contentType);
    const event = await getEvent(eventId);
    if (!event?.id || event.isPublished === false) return res.status(404).json({ error: 'Evento não encontrado.' });

    selfieKey = `face-search/selfies/${eventId}/${randomUUID()}`;
    const object = await uploadPrivateImage({ key: selfieKey, buffer, contentType, metadata: { eventId, temporary: 'true' } });
    const faceMatches = await searchFaces(object);
    const matches = await getMatchesByEvent(eventId, faceMatches.flatMap((match) => match.Face?.FaceId ? [{
      faceId: match.Face.FaceId,
      similarity: match.Similarity || 0,
    }] : []));
    console.info('[aws-rekognition] face:found', { eventId, count: matches.length, processingMs: Date.now() - startedAt });
    return res.status(200).json({ matches });
  } catch (error: any) {
    const response = faceError(error, 'Não foi possível buscar fotos por rosto.');
    console.error('[aws-rekognition] search:error', { name: error?.name, message: error?.message });
    return res.status(response.statusCode).json({ error: response.message });
  } finally {
    if (selfieKey) await deletePrivateObject(selfieKey).catch((error) => console.error('[aws-s3] selfie:delete-error', { selfieKey, message: error?.message }));
  }
}

export async function faceConsentHandler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const body = await readJsonBody(req);
    const sessionId = String(body?.sessionId || '').trim();
    const accepted = body?.accepted === true;
    if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId invalido.' });
    }
    if (!accepted) return res.status(400).json({ error: 'Consentimento não aceito.' });

    const authUser = await getAuthenticatedUser(req).catch(() => null);
    const acceptedAt = await createFaceSearchConsent({
      sessionId,
      accepted,
      userId: authUser?.id || null,
      ipAddress: getClientIp(req),
      userAgent: String(req.headers?.['user-agent'] || ''),
    });
    console.info('[face-consent] accepted', {
      sessionId,
      userId: authUser?.id || null,
      acceptedAt,
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 180),
    });
    return res.status(200).json({ status: 'ok', acceptedAt, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (error: any) {
    const rawMessage = String(error?.message || '');
    if (/face_search_consents|schema cache|relation .* does not exist|PGRST20/i.test(rawMessage)) {
      console.error('[face-consent] schema-missing', { message: rawMessage });
      return res.status(503).json({
        error: 'Tabela de consentimento facial não aplicada. Execute npm run supabase:schema:apply e publique o backend novamente.',
      });
    }
    const response = faceError(error, 'Não foi possível registrar o consentimento.');
    console.error('[face-consent] error', { name: error?.name, message: error?.message });
    return res.status(response.statusCode).json({ error: response.message });
  }
}

export async function testFaceHandler(req: any, res: any) {
  const secret = process.env.OPERATIONS_SECRET || process.env.CRON_SECRET || '';
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (process.env.NODE_ENV === 'production' && (!secret || bearer !== secret)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  let stage = 'configuration';
  try {
    const s3Config = getAwsS3Config();
    const rekognitionConfig = getRekognitionConfig();
    stage = 's3';
    const s3 = await testS3Connection();
    stage = 'rekognition';
    const rekognition = await testRekognitionConnection();
    return res.status(200).json({
      status: 'ok',
      configuration: {
        bucketConfigured: Boolean(s3Config.bucket),
        regionConfigured: Boolean(s3Config.region),
        collectionConfigured: Boolean(rekognitionConfig.collectionId),
      },
      s3,
      rekognition,
      credentials: 'ok',
    });
  } catch (error: any) {
    const errorName = String(error?.name || 'AwsConfigurationError');
    const isConfigurationError = /nao configurado/i.test(String(error?.message || ''));
    const safeMessage = isConfigurationError
      ? String(error.message)
      : `Falha AWS em ${stage}: ${errorName}.`;
    console.error('[aws-face-test] error', { stage, name: errorName, message: error?.message });
    return res.status(503).json({ status: 'error', stage, error: safeMessage });
  }
}

export async function backfillFaceHandler(req: any, res: any) {
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const operationsSecret = process.env.OPERATIONS_SECRET || '';
  const hasOperationsAccess = Boolean(operationsSecret && bearer === operationsSecret);
  const authUser = hasOperationsAccess ? null : await getAuthenticatedUser(req);
  const role = String(authUser?.app_metadata?.role || '');
  const isAdmin = role === 'admin' || role === 'super_admin';

  if (!hasOperationsAccess && !isAdmin) {
    return res.status(401).json({ error: 'Acesso administrativo necessario.' });
  }

  try {
    const result = await runFaceBackfill();
    return res.status(200).json(result);
  } catch (error: any) {
    const message = String(error?.message || 'Não foi possível executar o backfill facial.');
    console.error('[face-backfill] batch:error', { name: error?.name, message });
    return res.status(500).json({ error: message });
  }
}
