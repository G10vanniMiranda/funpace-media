import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('photographer upload reports missing local files without aborting the whole batch message', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');

  assert.match(dashboard, /isMissingLocalUploadFileError/);
  assert.match(dashboard, /requested file or directory could not be found/);
  assert.match(dashboard, /arquivo local.*durante a publica/i);
  assert.match(dashboard, /Verifique se as fotos ainda existem no armazenamento/);
  assert.doesNotMatch(dashboard, /Nenhum arquivo foi publicado\. Primeiro erro/);
});

test('photographer upload keeps partial publication counts and failed files selected', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');

  assert.match(dashboard, /Upload parcial concluido/);
  assert.match(dashboard, /Publicadas: \$\{publishedCount\} foto\(s\)/);
  assert.match(dashboard, /Falharam: \$\{failedUploads\.length\}/);
  assert.match(dashboard, /setSelectedFiles\(\(current\) => current\.filter/);
  assert.match(dashboard, /stage: UploadPublishStage/);
  assert.match(dashboard, /getUploadStageLabel/);
  assert.match(dashboard, /uploadCompletionNotice/);
});

test('database publication failures can resume after storage upload without reuploading media', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const resumableUpload = readFileSync('src/lib/resumable-upload.ts', 'utf8');

  assert.match(resumableUpload, /'uploaded'/);
  assert.match(resumableUpload, /'db_saved'/);
  assert.match(resumableUpload, /'published'/);
  assert.match(resumableUpload, /uploadedFilePath/);
  assert.match(resumableUpload, /uploadedThumbnailPath/);
  assert.match(dashboard, /item\.uploadedFilePath/);
  assert.match(dashboard, /status: 'uploaded'/);
  assert.match(dashboard, /status: 'db_saved'/);
  assert.match(dashboard, /status: 'published'/);
  assert.match(dashboard, /createProductBatched\(productPayload\)/);
  assert.match(dashboard, /scheduleDeferredThumbnailProcessing/);
  assert.match(dashboard, /enqueueMediaProcessingJobs/);
  assert.match(dashboard, /media-job:queued/);
  assert.match(dashboard, /deferredThumbnailConcurrencyLimit/);
  assert.match(dashboard, /deferredThumbnailQueue/);
  assert.match(dashboard, /thumbnail:deferred:queued/);
  assert.match(dashboard, /thumbnail:deferred:progress/);
  assert.match(dashboard, /thumbnail:deferred:start/);
  assert.match(dashboard, /thumbnail:deferred:done/);
  assert.match(dashboard, /stageDurationsMs/);
  assert.match(dashboard, /stageAverageMs/);
  assert.match(dashboard, /primaryBottleneckStage/);
  assert.match(dashboard, /primaryBottleneckDurationMs/);
  assert.match(dashboard, /effectiveOriginalUploadMBps/);
  assert.match(dashboard, /batchUploadedOriginalBytes/);
  assert.match(dashboard, /uploadProcessingJobsByProduct/);
  assert.match(dashboard, /getMediaProcessingJobs\(productIds\)/);
  assert.match(dashboard, /media-job:status-refresh/);
  assert.match(dashboard, /getProcessingStatusLabel/);
  assert.match(dashboard, /Proc\. fila/);
  assert.match(services, /addProductResilient/);
  assert.match(services, /addProductsBatchResilient/);
  assert.match(services, /updateProductProcessingMedia/);
  assert.match(services, /media_processing_jobs/);
  assert.match(services, /media-job:enqueue-failed/);
  assert.match(services, /db:batch-create-fallback/);
  assert.match(services, /db:create-recovered/);
  assert.match(services, /products\.find-created-after-failure/);
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
  assert.match(services, /directMediaUploadEnabled/);
  assert.match(services, /uploadMediaFileDirectSupabase/);
  assert.match(services, /direct upload unavailable, falling back to proxy/);
  assert.match(services, /\[media-upload\] network retry/);
  assert.match(services, /\[media-upload\] http retry/);
  assert.match(services, /payload\?\.verified === false/);
});

test('optional Supabase direct upload is multiplexed and keeps external bucket fallback', () => {
  const directUpload = readFileSync('server/api/media/direct-upload.ts', 'utf8');
  const system = readFileSync('api/system.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');

  assert.match(directUpload, /createSignedUploadUrl/);
  assert.match(directUpload, /external_bucket/);
  assert.match(directUpload, /BUCKET_API_TOKEN/);
  assert.match(directUpload, /isSafeStoragePath/);
  assert.match(system, /media-direct-upload/);
  assert.match(vercel, /\/api\/media\/direct-upload/);
  assert.match(vercel, /\/api\/system\?route=media-direct-upload/);
});

test('media processing jobs are queued and exposed only through operations diagnostics', () => {
  const dashboard = readFileSync('src/components/PhotographerDashboard.tsx', 'utf8');
  const services = readFileSync('src/lib/services.ts', 'utf8');
  const mediaJobs = readFileSync('server/api/media/jobs.ts', 'utf8');
  const mediaWorker = readFileSync('server/media/media-processing-worker.ts', 'utf8');
  const mediaRepository = readFileSync('server/media/media-job-repository.ts', 'utf8');
  const sql = readFileSync('scripts/add-media-processing-worker.sql', 'utf8');
  const system = readFileSync('api/system.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');

  assert.match(dashboard, /media-job:queued/);
  assert.match(services, /media_processing_jobs/);
  assert.match(mediaJobs, /OPERATIONS_SECRET/);
  assert.match(mediaJobs, /CRON_SECRET/);
  assert.match(mediaJobs, /worker:\s*\{/);
  assert.match(mediaJobs, /runMediaProcessingWorker/);
  assert.match(mediaJobs, /action=process/);
  assert.match(mediaJobs, /reprocess-failed/);
  assert.match(mediaJobs, /requeueFailedMediaJobs/);
  assert.match(mediaWorker, /MEDIA_PROCESSOR_ENABLED/);
  assert.match(mediaWorker, /batch:disabled/);
  assert.match(mediaWorker, /claimPendingMediaJobs\(batchSize\)/);
  assert.match(mediaWorker, /sharp/);
  assert.match(mediaWorker, /processImageJob/);
  assert.match(mediaWorker, /updateProductProcessedMedia/);
  assert.match(mediaRepository, /rpc\/claim_media_processing_jobs/);
  assert.match(mediaRepository, /rpc\/count_media_processing_pending/);
  assert.match(mediaRepository, /requeueFailedMediaJobs/);
  assert.match(mediaRepository, /status: 'pending'/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /limit least\(greatest\(batch_size, 1\), 50\)/i);
  assert.match(sql, /attempts = j\.attempts \+ 1/);
  assert.match(sql, /grant execute on function public\.claim_media_processing_jobs\(integer, integer\) to service_role/);
  assert.match(system, /media-jobs/);
  assert.match(vercel, /\/api\/media\/jobs/);
  assert.match(vercel, /\/api\/media\/jobs\/process/);
  assert.match(vercel, /"api\/system\.ts"[\s\S]*?"maxDuration": 300/);
  assert.match(vercel, /\/api\/system\?route=media-jobs/);
  assert.match(vercel, /\/api\/system\?route=media-jobs&action=process/);
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
