import {
  claimPendingMediaJobs,
  getMediaProcessingProduct,
  getPendingMediaJobCount,
  markMediaJobDone,
  markMediaJobFailed,
  updateProductProcessedMedia,
  type MediaProcessingJob,
} from './media-job-repository.js';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

export type MediaProcessingWorkerResult = {
  totalPending: number;
  claimed: number;
  processed: number;
  done: number;
  failed: number;
  skipped: number;
};

const batchSize = 25;
const thumbnailMaxSide = Number(process.env.MEDIA_THUMBNAIL_MAX_SIDE || 960);
const watermarkMaxSide = Number(process.env.MEDIA_WATERMARK_MAX_SIDE || 1800);
const thumbnailQuality = Number(process.env.MEDIA_THUMBNAIL_QUALITY || 82);
const watermarkQuality = Number(process.env.MEDIA_WATERMARK_QUALITY || 86);

function getMediaWorkerConfig() {
  const concurrency = Number(process.env.MEDIA_PROCESSING_CONCURRENCY || 2);
  return {
    concurrency: Math.min(5, Math.max(1, Number.isFinite(concurrency) ? concurrency : 2)),
    externalProcessorEnabled: process.env.MEDIA_PROCESSOR_ENABLED === 'true',
    mediaStorageProvider: process.env.MEDIA_STORAGE_PROVIDER || 'supabase',
    mediaBucket: process.env.MEDIA_BUCKET || process.env.SUPABASE_BUCKET || process.env.BUCKET || '',
  };
}

function getSupabaseStorageClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurado para o worker de midia.');
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabase: createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }),
  };
}

function normalizeStoragePath(raw: string, supabaseUrl: string, bucket: string) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('sourceUrl vazio.');
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');

  const prefix = `${supabaseUrl}/storage/v1/object/public/${bucket}/`;
  if (value.startsWith(prefix)) {
    return decodeURIComponent(value.slice(prefix.length)).replace(/^\/+/, '');
  }

  throw new Error('Worker server-side suporta apenas paths do Supabase Storage neste momento.');
}

function createOutputPath(job: MediaProcessingJob) {
  const extension = job.kind === 'thumbnail' ? 'thumb' : 'watermark';
  return [
    job.photographerId,
    'processed',
    job.productId,
    `${extension}-${job.id}.jpg`,
  ].join('/');
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createWatermarkSvg(width: number, height: number) {
  const text = escapeSvgText(process.env.MEDIA_WATERMARK_TEXT || 'FUNPACE MEDIA');
  const fontSize = Math.max(18, Math.round(Math.min(width, height) / 16));
  const stepX = Math.max(220, Math.round(width / 2.4));
  const stepY = Math.max(120, Math.round(height / 4.4));
  const items: string[] = [];

  for (let y = -height; y <= height * 2; y += stepY) {
    for (let x = -width; x <= width * 2; x += stepX) {
      items.push(`<text x="${x}" y="${y}" class="mark">${text}</text>`);
    }
  }

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .mark { font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}px; font-weight: 900; fill: rgba(255,255,255,0.20); stroke: rgba(0,0,0,0.20); stroke-width: 2px; letter-spacing: 2px; }
      </style>
      <g transform="rotate(-28 ${width / 2} ${height / 2})">${items.join('')}</g>
    </svg>
  `);
}

async function transformImage(input: Buffer, kind: MediaProcessingJob['kind']) {
  const maxSide = kind === 'thumbnail' ? thumbnailMaxSide : watermarkMaxSide;
  const quality = kind === 'thumbnail' ? thumbnailQuality : watermarkQuality;
  const base = sharp(input, { failOn: 'none' }).rotate().resize({
    width: maxSide,
    height: maxSide,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const metadata = await base.metadata();
  const width = metadata.width || maxSide;
  const height = metadata.height || maxSide;
  const watermark = createWatermarkSvg(width, height);
  return base
    .composite([{ input: watermark, blend: 'over' }])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function processImageJob(job: MediaProcessingJob) {
  const { mediaStorageProvider, mediaBucket } = getMediaWorkerConfig();
  if (mediaStorageProvider !== 'supabase') {
    throw new Error('Worker de thumbnail/watermark server-side requer MEDIA_STORAGE_PROVIDER=supabase. Para external_bucket, use worker externo/container.');
  }
  if (!mediaBucket) throw new Error('MEDIA_BUCKET nao configurado para o worker de midia.');

  const { supabaseUrl, supabase } = getSupabaseStorageClient();
  const sourcePath = normalizeStoragePath(job.sourceUrl || '', supabaseUrl, mediaBucket);
  const outputPath = createOutputPath(job);
  const downloadStartedAt = Date.now();
  const download = await supabase.storage.from(mediaBucket).download(sourcePath);
  if (download.error || !download.data) {
    throw new Error(download.error?.message || 'Nao foi possivel baixar a midia original do storage.');
  }

  const input = Buffer.from(await download.data.arrayBuffer());
  const transformStartedAt = Date.now();
  const output = await transformImage(input, job.kind);
  const uploadStartedAt = Date.now();
  const upload = await supabase.storage.from(mediaBucket).upload(outputPath, output, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  });
  if (upload.error) {
    throw new Error(upload.error.message || 'Nao foi possivel gravar midia processada no storage.');
  }

  if (job.kind === 'thumbnail') {
    await updateProductProcessedMedia(job.productId!, { thumbnailUrl: outputPath });
  } else if (job.kind === 'watermark') {
    await updateProductProcessedMedia(job.productId!, { watermarkUrl: outputPath });
  }

  console.info('[media-worker] job:processed', {
    jobId: job.id,
    productId: job.productId,
    kind: job.kind,
    sourcePath,
    outputPath,
    inputBytes: input.length,
    outputBytes: output.length,
    downloadMs: transformStartedAt - downloadStartedAt,
    transformMs: uploadStartedAt - transformStartedAt,
    uploadMs: Date.now() - uploadStartedAt,
  });

  return outputPath;
}

async function processMediaJob(job: MediaProcessingJob): Promise<'done' | 'failed' | 'skipped'> {
  const startedAt = Date.now();
  try {
    if (!job.productId || !job.sourceUrl) {
      throw new Error('Job de midia sem productId ou sourceUrl.');
    }

    if (job.kind === 'optimization') {
      await markMediaJobDone(job.id, job.sourceUrl);
      console.info('[media-worker] job:skipped', {
        jobId: job.id,
        productId: job.productId,
        kind: job.kind,
        reason: 'optimization-not-required',
        processingMs: Date.now() - startedAt,
      });
      return 'skipped';
    }

    if (!getMediaWorkerConfig().externalProcessorEnabled) {
      throw new Error('MEDIA_PROCESSOR_ENABLED=false; configure um processador server-side de thumbnail/watermark antes de executar este job.');
    }

    const product = await getMediaProcessingProduct(job.productId);
    if (!product) throw new Error('Produto do job de midia nao encontrado.');
    if (product.type !== 'IMG') {
      await markMediaJobDone(job.id, job.sourceUrl);
      console.info('[media-worker] job:skipped', {
        jobId: job.id,
        productId: job.productId,
        kind: job.kind,
        productType: product.type,
        reason: 'non-image-media',
        processingMs: Date.now() - startedAt,
      });
      return 'skipped';
    }

    const outputPath = await processImageJob(job);
    await markMediaJobDone(job.id, outputPath);
    return 'done';
  } catch (error: any) {
    const message = String(error?.message || 'Falha desconhecida no processamento de midia.');
    await markMediaJobFailed(job.id, message).catch(() => undefined);
    console.error('[media-worker] job:failed', {
      jobId: job.id,
      productId: job.productId,
      kind: job.kind,
      message,
      processingMs: Date.now() - startedAt,
    });
    return 'failed';
  }
}

export async function runMediaProcessingWorker(): Promise<MediaProcessingWorkerResult> {
  const startedAt = Date.now();
  const totalPending = await getPendingMediaJobCount();
  const { concurrency, externalProcessorEnabled } = getMediaWorkerConfig();
  if (!externalProcessorEnabled) {
    console.warn('[media-worker] batch:disabled', {
      totalPending,
      reason: 'MEDIA_PROCESSOR_ENABLED=false',
    });
    return { totalPending, claimed: 0, processed: 0, done: 0, failed: 0, skipped: 0 };
  }

  const jobs = await claimPendingMediaJobs(batchSize);
  const result: MediaProcessingWorkerResult = {
    totalPending,
    claimed: jobs.length,
    processed: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };

  console.info('[media-worker] batch:start', {
    totalPending,
    claimed: jobs.length,
    concurrency,
    externalProcessorEnabled,
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const status = await processMediaJob(job);
      result.processed += 1;
      if (status === 'done') result.done += 1;
      else if (status === 'skipped') result.skipped += 1;
      else result.failed += 1;
      console.info('[media-worker] batch:progress', { ...result, remainingInBatch: jobs.length - result.processed });
    }
  });

  await Promise.all(workers);
  console.info('[media-worker] batch:done', { ...result, processingMs: Date.now() - startedAt });
  return result;
}
