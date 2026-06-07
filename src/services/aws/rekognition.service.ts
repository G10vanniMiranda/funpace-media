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

const region = process.env.AWS_REGION || 'sa-east-1';
const collectionId = process.env.AWS_REKOGNITION_COLLECTION || 'funpace-faces';
const similarityThreshold = Math.min(100, Math.max(0, Number(process.env.FACE_SIMILARITY_THRESHOLD || 90)));
const maxSearchFaces = Math.min(4096, Math.max(1, Number(process.env.FACE_SEARCH_MAX_CANDIDATES || 1000)));
const timeoutMs = Number(process.env.AWS_REQUEST_TIMEOUT_MS || 20_000);

let client: RekognitionClient | null = null;
let collectionPromise: Promise<void> | null = null;

function getClient() {
  if (!client) client = new RekognitionClient({ region });
  return client;
}

async function sendWithTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
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
  return { collectionId, region, similarityThreshold, maxSearchFaces };
}

export async function createCollection() {
  await sendWithTimeout((abortSignal) => getClient().send(new CreateCollectionCommand({
    CollectionId: collectionId,
  }), { abortSignal }));
  console.info('[aws-rekognition] collection:created', { collectionId, region });
}

export async function ensureCollection() {
  if (!collectionPromise) {
    collectionPromise = (async () => {
      try {
        await sendWithTimeout((abortSignal) => getClient().send(new DescribeCollectionCommand({
          CollectionId: collectionId,
        }), { abortSignal }));
      } catch (error) {
        if (!isMissingCollection(error)) throw error;
        await createCollection();
      }
    })().catch((error) => {
      collectionPromise = null;
      throw error;
    });
  }
  return collectionPromise;
}

export async function listCollections() {
  const result = await sendWithTimeout((abortSignal) => getClient().send(new ListCollectionsCommand({ MaxResults: 100 }), { abortSignal }));
  return result.CollectionIds || [];
}

export async function indexFaces(input: { bucket: string; key: string; photoId: string }): Promise<FaceRecord[]> {
  await ensureCollection();
  const result = await sendWithTimeout((abortSignal) => getClient().send(new IndexFacesCommand({
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
  const result = await sendWithTimeout((abortSignal) => getClient().send(new SearchFacesByImageCommand({
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
  const result = await sendWithTimeout((abortSignal) => getClient().send(new DeleteFacesCommand({
    CollectionId: collectionId,
    FaceIds: faceIds,
  }), { abortSignal }));
  return result.DeletedFaces || [];
}

export async function testRekognitionConnection() {
  await ensureCollection();
  const collections = await listCollections();
  return {
    collectionId,
    collectionExists: true,
    listedInFirstPage: collections.includes(collectionId),
    region,
  };
}
