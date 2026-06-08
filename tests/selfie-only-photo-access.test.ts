import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public product services do not list photos outside face search', () => {
  const source = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(source, /function isPubliclyListableProduct\(product: Product\)/);
  assert.match(source, /return product\.type === 'VIDEO' \|\| product\.type === 'VIEW'/);
  assert.match(source, /products\.filter\(isPubliclyListableProduct\)/);
  assert.match(source, /mockProducts\.filter\(\(product\) => isPubliclyListableProduct\(product\)/);
});

test('event pages only render photo grids for face search results', () => {
  const source = readFileSync('src/App.tsx', 'utf8');

  assert.match(source, /const displayPhotos = searchType === 'selfie'[\s\S]*: \[\]/);
  assert.match(source, /searchType === 'selfie' \? \(/);
  assert.match(source, /faceMatches \? \(/);
  assert.doesNotMatch(source, /<SelfieOnlyPhotoAccess/);
  assert.doesNotMatch(source, /Ver todas as fotos/);
  assert.doesNotMatch(source, /FOTOS DO EVENTO/);
});

test('event selfie notice explains privacy-first access', () => {
  const source = readFileSync('src/App.tsx', 'utf8');

  assert.match(source, /Encontre suas fotos através da Selfie/);
  assert.match(source, /Para proteger a privacidade dos participantes/);
  assert.match(source, /as fotos deste evento são exibidas apenas através da busca facial/);
});

test('database RLS keeps public product listing video-only', () => {
  const source = readFileSync('scripts/supabase-schema.sql', 'utf8');

  assert.match(source, /products_select_published_owner_or_admin/);
  assert.match(source, /status = 'published' and type in \('VIDEO', 'VIEW'\)/);
  assert.match(source, /"vendedorId" = auth\.uid\(\)::text/);
  assert.match(source, /public\.is_admin\(\)/);
});
