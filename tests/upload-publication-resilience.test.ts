import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('photographer upload reports missing local files without aborting the whole batch message', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');

  assert.match(dashboard, /isMissingLocalUploadFileError/);
  assert.match(dashboard, /requested file or directory could not be found/);
  assert.match(dashboard, /Nao foi possivel localizar o arquivo local/);
  assert.match(dashboard, /Verifique se as fotos ainda existem no armazenamento/);
  assert.doesNotMatch(dashboard, /Nenhum arquivo foi publicado\. Primeiro erro/);
});

test('photographer upload keeps partial publication counts and failed files selected', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');

  assert.match(dashboard, /Upload parcial concluido/);
  assert.match(dashboard, /Publicadas: \$\{publishedCount\} fotos/);
  assert.match(dashboard, /Falharam: \$\{failedUploads\.length\} fotos/);
  assert.match(dashboard, /setSelectedFiles\(\(current\) => current\.filter/);
  assert.match(dashboard, /stage: UploadPublishStage/);
  assert.match(dashboard, /getUploadStageLabel/);
});

test('publication flow logs client and backend storage diagnostics without secrets', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const mediaUploadApi = readFileSync('api/media/upload.ts', 'utf8');

  assert.match(dashboard, /\[photographer-upload\] file:start/);
  assert.match(dashboard, /\[photographer-upload\] storage:upload:start/);
  assert.match(dashboard, /\[photographer-upload\] storage:upload:done/);
  assert.match(dashboard, /\[photographer-upload\] file:failed/);
  assert.match(mediaUploadApi, /\[media-upload\] error/);
  assert.match(mediaUploadApi, /X-File-Hash/);
  assert.match(mediaUploadApi, /X-Upload-Batch-Id/);
  assert.match(mediaUploadApi, /verifyUploadedMedia/);
  assert.match(mediaUploadApi, /durationMs/);
  assert.match(mediaUploadApi, /bucket: mediaBucket/);
  assert.match(mediaUploadApi, /storagePath/);
  const errorLogBlock = mediaUploadApi.match(/console\.error\('\[media-upload\] error'[\s\S]*?\}\);/)?.[0] || '';
  assert.ok(errorLogBlock);
  assert.doesNotMatch(errorLogBlock, /externalBucketToken|BUCKET_API_TOKEN|BUCKET_X_API_TOKEN|Authorization|X-API-Token/);
});

test('browser upload retries network/proxy drops and requires storage confirmation', () => {
  const services = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(services, /clientUploadTimeoutMs/);
  assert.match(services, /\[media-upload\] network retry/);
  assert.match(services, /\[media-upload\] http retry/);
  assert.match(services, /payload\?\.verified === false/);
});

test('nginx reference config supports large media uploads without proxy buffering', () => {
  const nginx = readFileSync('ops/nginx-funpace-api.conf', 'utf8');

  assert.match(nginx, /client_max_body_size 300M;/);
  assert.match(nginx, /proxy_read_timeout 600s;/);
  assert.match(nginx, /proxy_send_timeout 600s;/);
  assert.match(nginx, /proxy_connect_timeout 600s;/);
  assert.match(nginx, /proxy_request_buffering off;/);
  assert.match(nginx, /proxy_buffering off;/);
});
