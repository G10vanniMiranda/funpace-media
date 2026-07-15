import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { processPhotoFaceIndex } from '../server/face/face-indexing.js';

const photoId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const photographerId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';

function photo(overrides: Record<string, unknown> = {}) {
  return {
    id: photoId,
    eventId,
    vendedorId: photographerId,
    storagePath: 'https://media.example.test/photo.jpg',
    url: 'https://media.example.test/photo.jpg',
    type: 'IMG',
    status: 'published',
    faceIndexStatus: 'pending',
    faceIndexAttempts: 0,
    faceIndexRunId: null,
    faceIndexError: null,
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getOwnedPhoto: async () => photo(),
    getEvent: async () => ({ id: eventId, photographerId, isPublished: true }),
    getPhotoFaces: async () => [],
    claimPhotoFaceIndex: async () => photo({ faceIndexStatus: 'processing', faceIndexAttempts: 1, faceIndexRunId: runId }),
    completePhotoFaceIndex: async () => photo({ faceIndexStatus: 'indexed', faceIndexAttempts: 1 }),
    failPhotoFaceIndex: async () => photo({ faceIndexStatus: 'failed', faceIndexAttempts: 1 }),
    uploadPrivateImage: async () => ({ bucket: 'faces', key: `face-index/events/${eventId}/photos/${photoId}` }),
    indexFaces: async () => [{ Face: { FaceId: 'face-1', ImageId: 'image-1', Confidence: 99.9, ExternalImageId: photoId } }],
    listFacesByExternalImageId: async () => [],
    removeFaces: async () => [],
    getRekognitionConfig: () => ({ collectionId: 'funpace-faces', region: 'sa-east-1', similarityThreshold: 90, maxSearchFaces: 1000, timeoutMs: 20_000 }),
    getCollectionMetadata: async () => ({ collectionId: 'funpace-faces', faceCount: 1, faceModelVersion: '7.0' }),
    fetch: async () => new Response(Buffer.from('jpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    ...overrides,
  } as any;
}

test('newly published photo performs the complete mocked AWS indexing flow', async () => {
  const calls: string[] = [];
  let persistedFaces: any[] = [];
  const deps = dependencies({
    claimPhotoFaceIndex: async () => {
      calls.push('processing');
      return photo({ faceIndexStatus: 'processing', faceIndexAttempts: 1, faceIndexRunId: runId });
    },
    indexFaces: async () => {
      calls.push('aws');
      return [{ Face: { FaceId: 'face-1', ImageId: 'image-1', Confidence: 99.9, ExternalImageId: photoId } }];
    },
    completePhotoFaceIndex: async (input: any) => {
      calls.push('persist-and-index');
      persistedFaces = input.faces;
      return photo({ faceIndexStatus: 'indexed', faceIndexAttempts: 1 });
    },
  });

  const result = await processPhotoFaceIndex({ photoId, eventId, photographerId }, deps);

  assert.deepEqual(calls, ['processing', 'aws', 'persist-and-index']);
  assert.equal(result.status, 'indexed');
  assert.equal(result.facesIndexed, 1);
  assert.equal(persistedFaces[0].faceId, 'face-1');
});

test('AWS response without faces finishes as no_face', async () => {
  let completedFaces: unknown[] | null = null;
  const result = await processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    indexFaces: async () => [],
    completePhotoFaceIndex: async (input: any) => {
      completedFaces = input.faces;
      return photo({ faceIndexStatus: 'no_face', faceIndexAttempts: 1 });
    },
  }));
  assert.equal(result.status, 'no_face');
  assert.deepEqual(completedFaces, []);
});

test('AWS failure records failed state with safe code and keeps photo published', async () => {
  let failure: any = null;
  await assert.rejects(() => processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    indexFaces: async () => { throw Object.assign(new Error('AWS unavailable'), { name: 'ServiceUnavailableException' }); },
    failPhotoFaceIndex: async (input: any) => {
      failure = input;
      return photo({ faceIndexStatus: 'failed', faceIndexAttempts: 1 });
    },
  })), /AWS unavailable/);
  assert.equal(failure.errorCode, 'ServiceUnavailableException');
  assert.equal(failure.photoId, photoId);
});

test('persistence failure never reports indexed and rolls back newly created AWS faces', async () => {
  const removed: string[] = [];
  let failed = false;
  await assert.rejects(() => processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    completePhotoFaceIndex: async () => { throw new Error('database unavailable'); },
    removeFaces: async (ids: string[]) => { removed.push(...ids); return ids; },
    failPhotoFaceIndex: async () => { failed = true; return photo({ faceIndexStatus: 'failed' }); },
  })), /database unavailable/);
  assert.deepEqual(removed, ['face-1']);
  assert.equal(failed, true);
});

test('already indexed photo is reused without claim or AWS duplication', async () => {
  let claimed = false;
  let indexed = false;
  const result = await processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    getOwnedPhoto: async () => photo({ faceIndexStatus: 'indexed', faceIndexAttempts: 1 }),
    getPhotoFaces: async () => [{ face_id: 'face-1', image_id: 'image-1', event_id: eventId, photo_id: photoId, confidence: 99.9 }],
    claimPhotoFaceIndex: async () => { claimed = true; return null; },
    indexFaces: async () => { indexed = true; return []; },
  }));
  assert.equal(result.reused, true);
  assert.equal(result.status, 'indexed');
  assert.equal(claimed, false);
  assert.equal(indexed, false);
});

test('simultaneous duplicate request observes processing claim and does not call AWS', async () => {
  let reads = 0;
  let indexed = false;
  const result = await processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    getOwnedPhoto: async () => reads++ === 0 ? photo() : photo({ faceIndexStatus: 'processing', faceIndexAttempts: 1, faceIndexRunId: runId }),
    claimPhotoFaceIndex: async () => null,
    indexFaces: async () => { indexed = true; return []; },
  }));
  assert.equal(result.status, 'processing');
  assert.equal(indexed, false);
});

test('retry recovers AWS faces by deterministic ExternalImageId instead of indexing again', async () => {
  let indexed = false;
  const result = await processPhotoFaceIndex({ photoId, eventId, photographerId }, dependencies({
    claimPhotoFaceIndex: async () => photo({ faceIndexStatus: 'processing', faceIndexAttempts: 2, faceIndexRunId: runId }),
    listFacesByExternalImageId: async () => [{ Face: { FaceId: 'recovered-face', ImageId: 'recovered-image', ExternalImageId: photoId, Confidence: 99 } }],
    indexFaces: async () => { indexed = true; return []; },
  }));
  assert.equal(result.status, 'indexed');
  assert.equal(result.reused, true);
  assert.equal(indexed, false);
});

test('incorrect eventId prevents processing before claim and AWS', async () => {
  let claimed = false;
  await assert.rejects(() => processPhotoFaceIndex({ photoId, eventId: '55555555-5555-4555-8555-555555555555', photographerId }, dependencies({
    claimPhotoFaceIndex: async () => { claimed = true; return null; },
  })), /nao pertence ao evento/);
  assert.equal(claimed, false);
});

test('publication uses a real lightweight backend request and atomic SQL lifecycle', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const sql = readFileSync('scripts/fix-face-publication-indexing.sql', 'utf8');
  assert.match(dashboard, /productService\.indexProductFace\(faceIndexPhotoId, faceIndexEventId\)/);
  assert.doesNotMatch(dashboard, /automatic:queued-background/);
  assert.match(services, /X-Photo-Id/);
  assert.match(services, /keepalive: true/);
  assert.match(services, /const maxAttempts = 3/);
  assert.doesNotMatch(services, /indexProductFace\(photoId: string, eventId: string, file: File\)/);
  assert.match(sql, /claim_photo_face_index/);
  assert.match(sql, /"faceIndexAttempts" = coalesce\(p\."faceIndexAttempts", 0\) \+ 1/);
  assert.match(sql, /"faceIndexRunId" = gen_random_uuid\(\)/);
  assert.match(sql, /for update/i);
  assert.match(sql, /insert into public\.photo_faces[\s\S]*update public\.products/);
  assert.match(sql, /case when face_count > 0 then 'indexed' else 'no_face' end/);
  assert.match(sql, /p\."faceIndexRunId" = target_run_id/);
});
