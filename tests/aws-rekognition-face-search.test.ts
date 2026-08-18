import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('AWS Rekognition service manages the production collection and face lifecycle', () => {
  const source = readFileSync('src/services/aws/rekognition.service.ts', 'utf8');
  assert.match(source, /export function getRekognitionConfig\(\)/);
  assert.doesNotMatch(source, /^const .*process\.env/m);
  assert.match(source, /CreateCollectionCommand/);
  assert.match(source, /ListCollectionsCommand/);
  assert.match(source, /IndexFacesCommand/);
  assert.match(source, /SearchFacesByImageCommand/);
  assert.match(source, /DeleteFacesCommand/);
  assert.match(source, /FACE_SIMILARITY_THRESHOLD \|\| 90/);
});

test('AWS configuration is read at runtime after dotenv initialization', () => {
  const server = readFileSync('server.ts', 'utf8');
  const s3 = readFileSync('src/services/aws/s3.service.ts', 'utf8');
  const rekognition = readFileSync('src/services/aws/rekognition.service.ts', 'utf8');

  assert.match(server, /^import "dotenv\/config";/);
  assert.match(s3, /export function getAwsS3Config\(\)/);
  assert.doesNotMatch(s3, /^const .*process\.env/m);
  assert.doesNotMatch(rekognition, /^const .*process\.env/m);
});

test('face migration is incremental, private and linked to events and products', () => {
  const sql = readFileSync('scripts/add-aws-rekognition-face-search.sql', 'utf8');
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.match(sql, /create table if not exists public\.photo_faces/);
  assert.match(sql, /face_id text not null unique/);
  assert.match(sql, /event_id uuid not null references public\.events/);
  assert.match(sql, /photo_id uuid not null references public\.products/);
  assert.match(sql, /alter table public\.photo_faces enable row level security/);
  assert.match(sql, /revoke all on table public\.photo_faces from anon, authenticated/);
});

test('selfie search always attempts to delete the temporary S3 object', () => {
  const source = readFileSync('server/face/face-handlers.ts', 'utf8');
  assert.match(source, /face-search\/selfies/);
  assert.match(source, /finally \{/);
  assert.match(source, /deletePrivateObject\(selfieKey\)/);
  assert.match(source, /getMatchesByEvent\(eventId/);
});

test('Vercel and Express expose face search, index, backfill and diagnostics routes', () => {
  const vercel = readFileSync('vercel.mjs', 'utf8');
  const express = readFileSync('server.ts', 'utf8');
  for (const route of ['/api/face/search', '/api/face/index', '/api/face/backfill', '/api/face/test']) {
    assert.match(vercel, new RegExp(route.replaceAll('/', '\\/')));
    assert.match(express, new RegExp(route.replaceAll('/', '\\/')));
  }
});

test('face backfill claims resumable image batches of at most 50 without duplicate workers', () => {
  const job = readFileSync('server/face/face-backfill.ts', 'utf8');
  const repository = readFileSync('server/face/face-repository.ts', 'utf8');
  const sql = readFileSync('scripts/add-aws-rekognition-face-search.sql', 'utf8');

  assert.match(job, /const batchSize = 50/);
  assert.match(job, /claimPendingFacePhotos\(batchSize\)/);
  assert.match(repository, /rpc\/claim_face_backfill_batch/);
  assert.match(repository, /rpc\/count_face_backfill_pending/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /limit least\(greatest\(batch_size, 1\), 50\)/i);
  assert.match(sql, /p\.status = 'published'/);
  assert.match(sql, /p\.type = 'IMG'/);
  assert.match(sql, /p\."eventId" is not null/);
  assert.match(sql, /p\."faceIndexStatus" = 'pending'\s+and p\."faceIndexedAt" is null/);
  assert.match(sql, /"faceIndexStatus" = 'processing'/);
  assert.match(sql, /stale_after_minutes/);
  assert.match(sql, /where \(status = 'removed' or type <> 'IMG'\)\s+and "faceIndexStatus" in \('pending', 'processing'\)/);
  assert.match(sql, /grant execute on function public\.claim_face_backfill_batch\(integer, integer\) to service_role/);
});

test('non-image products never enter the facial backfill queue', () => {
  const services = readFileSync('src/lib/services.ts', 'utf8');
  assert.match(services, /product\.type === 'IMG' \? product\.faceIndexStatus \?\? 'pending' : 'disabled'/);
  assert.match(services, /changes\.type === 'IMG' \? 'pending' : 'disabled'/);
});

test('face backfill records indexed, no-face and failed outcomes', () => {
  const job = readFileSync('server/face/face-backfill.ts', 'utf8');
  const handlers = readFileSync('server/face/face-handlers.ts', 'utf8');

  assert.match(job, /records\.length > 0 \? 'indexed' : 'no_face'/);
  assert.match(job, /updatePhotoFaceStatus\(photo\.id, 'failed', message\)/);
  assert.match(job, /replacePhotoFaces/);
  assert.match(job, /removeFaces/);
  assert.match(handlers, /hasOperationsAccess/);
  assert.match(handlers, /role === 'admin' \|\| role === 'super_admin'/);
});

test('only valid operations backfill requests bypass all face rate limits', () => {
  const express = readFileSync('server.ts', 'utf8');
  const vercel = readFileSync('api/face.ts', 'utf8');
  const helper = readFileSync('server/face/face-rate-limit.ts', 'utf8');

  assert.match(express, /skip: shouldBypassFaceBackfillRateLimit/);
  assert.match(vercel, /!bypassBackfillRateLimit && await rateLimitAsync/);
  assert.match(helper, /process\.env\.OPERATIONS_SECRET/);
  assert.match(helper, /method !== 'POST'/);
  assert.match(helper, /\/api\/face\/backfill/);
  assert.doesNotMatch(helper, /console\./);
});
