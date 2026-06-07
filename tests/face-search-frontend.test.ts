import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('face search frontend sends public multipart request without operations secret', () => {
  const source = readFileSync('src/lib/services.ts', 'utf8');
  const method = source.slice(source.indexOf('async searchByFace'), source.indexOf('async indexProductFace'));

  assert.match(method, /new FormData\(\)/);
  assert.match(method, /formData\.set\('eventId', eventId\)/);
  assert.match(method, /formData\.set\('sessionId', sessionId\)/);
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
  assert.match(source, /Permissao para Uso de Imagem/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /facingMode: 'user'/);
  assert.match(source, /dataUrlToBlob/);
  assert.match(source, /fileRef\.current/);
  assert.match(source, /const selectedFile = fileRef\.current \|\| file/);
  assert.match(source, /toDataURL\('image\/jpeg'/);
  assert.match(source, /Capturando selfie/);
  assert.match(source, /Precisamos de acesso a camera/);
  assert.match(source, /Estou ciente/);
  assert.match(source, /Procurando suas fotos/);
  assert.match(source, /Usar esta selfie/);
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
  assert.match(method, /Permissao para uso de imagem necessaria/);
  assert.doesNotMatch(method, /OPERATIONS_SECRET|Authorization/);
});

test('face search requires LGPD consent on frontend and backend', () => {
  const modal = readFileSync('src/components/FaceSearchModal.tsx', 'utf8');
  const handlers = readFileSync('server/face/face-handlers.ts', 'utf8');
  const repository = readFileSync('server/face/face-repository.ts', 'utf8');
  const migration = readFileSync('scripts/add-aws-rekognition-face-search.sql', 'utf8');

  assert.match(modal, /funpace:face-search-consent/);
  assert.match(modal, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(modal, /recordFaceSearchConsent/);
  assert.match(handlers, /faceConsentHandler/);
  assert.match(handlers, /hasValidFaceSearchConsent/);
  assert.match(handlers, /Consentimento LGPD necessario/);
  assert.match(repository, /face_search_consents/);
  assert.match(repository, /accepted_at=gte/);
  assert.match(migration, /create table if not exists public\.face_search_consents/);
  assert.match(migration, /face_search_consents_session_accepted_idx/);
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
