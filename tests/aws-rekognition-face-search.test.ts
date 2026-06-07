import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('AWS Rekognition service manages the production collection and face lifecycle', () => {
  const source = readFileSync('src/services/aws/rekognition.service.ts', 'utf8');
  assert.match(source, /AWS_REKOGNITION_COLLECTION \|\| 'funpace-faces'/);
  assert.match(source, /CreateCollectionCommand/);
  assert.match(source, /ListCollectionsCommand/);
  assert.match(source, /IndexFacesCommand/);
  assert.match(source, /SearchFacesByImageCommand/);
  assert.match(source, /DeleteFacesCommand/);
  assert.match(source, /FACE_SIMILARITY_THRESHOLD \|\| 90/);
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

test('Vercel and Express expose face search, index and diagnostics routes', () => {
  const vercel = readFileSync('vercel.json', 'utf8');
  const express = readFileSync('server.ts', 'utf8');
  for (const route of ['/api/face/search', '/api/face/index', '/api/face/test']) {
    assert.match(vercel, new RegExp(route.replaceAll('/', '\\/')));
    assert.match(express, new RegExp(route.replaceAll('/', '\\/')));
  }
});
