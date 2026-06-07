import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('face search frontend sends public multipart request without operations secret', () => {
  const source = readFileSync('src/lib/services.ts', 'utf8');
  const method = source.slice(source.indexOf('async searchByFace'), source.indexOf('async indexProductFace'));

  assert.match(method, /new FormData\(\)/);
  assert.match(method, /formData\.set\('eventId', eventId\)/);
  assert.match(method, /formData\.set\('selfie', file, file\.name\)/);
  assert.match(method, /apiUrl\('\/api\/face\/search'\)/);
  assert.doesNotMatch(method, /Authorization|OPERATIONS_SECRET/);
});

test('face search modal validates selfie and provides professional search states', () => {
  const source = readFileSync('src/components/FaceSearchModal.tsx', 'utf8');

  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /8 \* 1024 \* 1024/);
  assert.match(source, /Trocar selfie/);
  assert.match(source, /Buscando suas fotos com reconhecimento facial/);
  assert.match(source, /Buscar minhas fotos/);
});

test('event galleries expose face search and preserve original photo results', () => {
  const source = readFileSync('src/App.tsx', 'utf8');

  assert.match(source, /Encontrar minhas fotos com selfie/);
  assert.match(source, /const \[faceSearchMatches, setFaceSearchMatches\]/);
  assert.match(source, /const clearFaceSearch = \(\)/);
  assert.match(source, /Ver todas as fotos/);
});
