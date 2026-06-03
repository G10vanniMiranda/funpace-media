import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('multi-photographer face architecture SQL is incremental and non-destructive', () => {
  const sql = readFileSync('scripts/add-multiphoto-face-architecture.sql', 'utf8');

  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+column\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.match(sql, /alter table public\.products add column if not exists "ownerId"/);
  assert.match(sql, /alter table public\.order_items add column if not exists "photographerAmount"/);
});

test('multi-photographer face architecture creates global private indexes with RLS', () => {
  const sql = readFileSync('scripts/add-multiphoto-face-architecture.sql', 'utf8');

  assert.match(sql, /create extension if not exists vector/);
  assert.match(sql, /create table if not exists public\.media_face_embeddings/);
  assert.match(sql, /"faceEmbedding" vector\(512\) not null/);
  assert.match(sql, /using ivfflat \("faceEmbedding" vector_cosine_ops\)/);
  assert.match(sql, /create table if not exists public\.media_ocr_indexes/);
  assert.match(sql, /create table if not exists public\.media_indexing_jobs/);
  assert.match(sql, /alter table public\.media_face_embeddings enable row level security/);
  assert.match(sql, /media_face_embeddings_admin_only/);
});

test('deferred multi-photographer migration apply script is explicitly gated', () => {
  const script = readFileSync('scripts/apply-multiphoto-face-architecture.mjs', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');

  assert.match(script, /ENABLE_DEFERRED_MULTIPHOTO_FACE_ARCHITECTURE/);
  assert.match(script, /Arquitetura multi-fotografo\/face global esta adiada/);
  assert.doesNotMatch(packageJson, /supabase:multiphoto:apply/);
  assert.doesNotMatch(packageJson, /supabase:multiphoto:dry-run/);
});
