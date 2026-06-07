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
  assert.match(source, /capture="user"/);
  assert.match(source, /Usar camera/);
  assert.match(source, /Procurando suas fotos/);
  assert.match(source, /Buscar minhas fotos/);
});

test('event galleries expose face search and preserve original photo results', () => {
  const source = readFileSync('src/App.tsx', 'utf8');

  assert.match(source, /Encontrar minhas fotos com selfie/);
  assert.match(source, /const \[faceSearchMatches, setFaceSearchMatches\]/);
  assert.match(source, /const clearFaceSearch = \(\)/);
  assert.match(source, /Limpar Busca/);
  assert.match(source, /FOTOS ENCONTRADAS/);
  assert.match(source, /Fotos Encontradas/);
  assert.match(source, /Nenhuma foto sua foi encontrada neste evento/);
});

test('face search presents safe customer-facing API errors', () => {
  const source = readFileSync('src/lib/services.ts', 'utf8');
  const method = source.slice(source.indexOf('async searchByFace'), source.indexOf('async indexProductFace'));

  assert.match(method, /Nao foi possivel realizar a busca facial/);
  assert.match(method, /Nenhuma foto sua foi encontrada neste evento/);
  assert.doesNotMatch(method, /OPERATIONS_SECRET|Authorization/);
});

test('public event page uses compact premium layout without changing gallery behavior', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const page = app.slice(app.indexOf('function PublicEventPage'), app.indexOf('function EventMeta'));
  const photoGrid = readFileSync('src/components/PhotoGrid.tsx', 'utf8');
  const videoGrid = readFileSync('src/components/VideoGrid.tsx', 'utf8');

  assert.match(page, /lg:grid-cols-\[minmax\(300px,0\.82fr\)_minmax\(0,1\.5fr\)\]/);
  assert.match(page, /Encontre suas fotos com uma selfie/);
  assert.match(page, /Tirar selfie/);
  assert.match(page, /Carregar foto/);
  assert.match(page, /Ver todas as fotos/);
  assert.match(page, /EventCompactStat/);
  assert.match(page, /onAddToCart=\{onAddToCart\}/);
  assert.match(photoGrid, /compact\?: boolean/);
  assert.match(videoGrid, /compact\?: boolean/);
});
