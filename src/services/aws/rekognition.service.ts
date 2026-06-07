import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  DescribeCollectionCommand,
  IndexFacesCommand,
  ListCollectionsCommand,
  RekognitionClient,
  SearchFacesByImageCommand,
  type FaceRecord,
  type FaceMatch,
} from '@aws-sdk/client-rekognition';

let client: RekognitionClient | null = null;
let clientRegion = '';
const collectionPromises = new Map<string, Promise<void>>();

function getClient(region: string) {
  if (!client || clientRegion !== region) {
    client = new RekognitionClient({ region });
    clientRegion = region;
  }
  return client;
}

async function sendWithTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function isMissingCollection(error: any) {
  return error?.name === 'ResourceNotFoundException';
}

export function getRekognitionConfig() {
  const region = String(process.env.AWS_REGION || '').trim();
  const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '').trim();
  const similarityThreshold = Math.min(100, Math.max(0, Number(process.env.FACE_SIMILARITY_THRESHOLD || 90)));
  const maxSearchFaces = Math.min(4096, Math.max(1, Number(process.env.FACE_SEARCH_MAX_CANDIDATES || 1000)));
  const configuredTimeout = Number(process.env.AWS_REQUEST_TIMEOUT_MS || 20_000);

  if (!region) throw new Error('AWS_REGION nao configurado.');
  if (!collectionId) throw new Error('AWS_REKOGNITION_COLLECTION nao configurado.');

  return {
    collectionId,
    region,
    similarityThreshold,
    maxSearchFaces,
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20_000,
  };
}

export async function createCollection() {
  const { collectionId, region, timeoutMs } = getRekognitionConfig();
  await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new CreateCollectionCommand({
    CollectionId: collectionId,
  }), { abortSignal }));
  console.info('[aws-rekognition] collection:created', { collectionId, region });
}

export async function ensureCollection() {
  const config = getRekognitionConfig();
  const cacheKey = `${config.region}:${config.collectionId}`;
  if (!collectionPromises.has(cacheKey)) {
    const promise = (async () => {
      try {
        await sendWithTimeout(config.timeoutMs, (abortSignal) => getClient(config.region).send(new DescribeCollectionCommand({
          CollectionId: config.collectionId,
        }), { abortSignal }));
      } catch (error) {
        if (!isMissingCollection(error)) throw error;
        await createCollection();
      }
    })().catch((error) => {
      collectionPromises.delete(cacheKey);
      throw error;
    });
    collectionPromises.set(cacheKey, promise);
  }
  return collectionPromises.get(cacheKey);
}

export async function listCollections() {
  const { region, timeoutMs } = getRekognitionConfig();
  const result = await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new ListCollectionsCommand({ MaxResults: 100 }), { abortSignal }));
  return result.CollectionIds || [];
}

export async function indexFaces(input: { bucket: string; key: string; photoId: string }): Promise<FaceRecord[]> {
  await ensureCollection();
  const { collectionId, region, timeoutMs } = getRekognitionConfig();
  const result = await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new IndexFacesCommand({
    CollectionId: collectionId,
    Image: { S3Object: { Bucket: input.bucket, Name: input.key } },
    ExternalImageId: input.photoId,
    MaxFaces: 100,
    QualityFilter: 'AUTO',
    DetectionAttributes: ['DEFAULT'],
  }), { abortSignal }));
  const faces = result.FaceRecords || [];
  console.info('[aws-rekognition] face:indexed', { photoId: input.photoId, count: faces.length });
  return faces;
}

export async function searchFaces(input: { bucket: string; key: string }): Promise<FaceMatch[]> {
  await ensureCollection();
  const { collectionId, region, similarityThreshold, maxSearchFaces, timeoutMs } = getRekognitionConfig();
  const result = await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new SearchFacesByImageCommand({
    CollectionId: collectionId,
    Image: { S3Object: { Bucket: input.bucket, Name: input.key } },
    FaceMatchThreshold: similarityThreshold,
    MaxFaces: maxSearchFaces,
  }), { abortSignal }));
  const matches = result.FaceMatches || [];
  console.info('[aws-rekognition] face:search', { count: matches.length, similarityThreshold });
  return matches;
}

export async function removeFaces(faceIds: string[]) {
  if (faceIds.length === 0) return [];
  await ensureCollection();
  const { collectionId, region, timeoutMs } = getRekognitionConfig();
  const result = await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new DeleteFacesCommand({
    CollectionId: collectionId,
    FaceIds: faceIds,
  }), { abortSignal }));
  return result.DeletedFaces || [];
}

export async function testRekognitionConnection() {
  const { collectionId, region } = getRekognitionConfig();
  await ensureCollection();
  const collections = await listCollections();
  return {
    collectionId,
    collectionExists: true,
    listedInFirstPage: collections.includes(collectionId),
    region,
  };
}
