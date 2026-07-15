import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('scripts/backfill-face-indexing.ts', 'utf8');

test('phase 2 backfill reuses the validated publication indexing flow', () => {
  assert.match(source, /import \{ processPhotoFaceIndex \} from '..\/server\/face\/face-indexing\.js'/);
  assert.match(source, /await processPhotoFaceIndex\(\{ photoId: candidate\.id, eventId: candidate\.eventId!, photographerId: candidate\.photographerId! \}\)/);
  assert.doesNotMatch(source, /IndexFacesCommand|indexFaces\(|replacePhotoFaces|removeFaces|delete from|method:\s*'DELETE'/i);
});

test('phase 2 candidate selection is restricted and detects inconsistent pending rows', () => {
  assert.match(source, /status = 'published'/);
  assert.match(source, /type = 'IMG'/);
  assert.match(source, /"faceIndexStatus" = 'pending'/);
  assert.match(source, /pending_with_existing_photo_faces/);
  assert.match(source, /event_photographer_mismatch/);
  assert.match(source, /storage_object_missing/);
});

test('phase 2 dry-run and pilot have explicit operational safety gates', () => {
  assert.match(source, /if \(mode === 'dry-run'\) return/);
  assert.match(source, /confirmation !== 'BACKFILL_FACE_INDEX'/);
  assert.match(source, /limit > 10 && args\.get\('allow-larger-batch'\) !== 'true'/);
  assert.match(source, /Math\.min\(3, Number\(args\.get\('concurrency'\)/);
  assert.match(source, /args\.get\('checkpoint-size'\)/);
  assert.match(source, /consecutiveFailures >= 6/);
  assert.match(source, /processing_not_zero_at_checkpoint/);
  assert.match(source, /remainingEligibleEstimate/);
  assert.match(source, /workerUtilizationPercent/);
  assert.match(source, /significant_speed_drop/);
  assert.match(source, /duplicate_face_ids/);
  assert.match(source, /abnormal_average_time/);
  assert.match(source, /process\.once\('SIGINT'/);
  assert.match(source, /pinnedIds\.length !== limit/);
  assert.match(source, /attempt <= 3/);
  assert.match(source, /resume-stale-processing/);
  assert.match(source, /"faceProcessingStartedAt" < now\(\) - interval '15 minutes'/);
});
