import { supabaseRequest } from '../shared/utils.js';

export type MediaProcessingJobKind = 'thumbnail' | 'watermark' | 'optimization';
export type MediaProcessingJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type MediaProcessingJob = {
  id: string;
  productId: string | null;
  photographerId: string;
  kind: MediaProcessingJobKind;
  status: MediaProcessingJobStatus;
  sourceUrl: string | null;
  outputUrl: string | null;
  error: string | null;
  attempts: number;
  lastStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaProcessingProduct = {
  id: string;
  type: 'IMG' | 'VIDEO' | 'VIEW' | string;
  url: string | null;
  thumbnailUrl: string | null;
  watermarkUrl: string | null;
};

export async function getPendingMediaJobCount() {
  const count = await supabaseRequest<number>('/rest/v1/rpc/count_media_processing_pending', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return Number(count || 0);
}

export async function claimPendingMediaJobs(limit = 25): Promise<MediaProcessingJob[]> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  return supabaseRequest<MediaProcessingJob[]>('/rest/v1/rpc/claim_media_processing_jobs', {
    method: 'POST',
    body: JSON.stringify({ batch_size: safeLimit, stale_after_minutes: 15 }),
  });
}

function postgrestUuidIn(values: string[]) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '')}"`).join(',')})`;
}

export async function requeueFailedMediaJobs(input: { limit?: number; productId?: string | null } = {}) {
  const limit = Math.min(100, Math.max(1, Number(input.limit || 50)));
  const params = new URLSearchParams({
    select: 'id',
    status: 'eq.failed',
    order: 'updatedAt.asc',
    limit: String(limit),
  });
  if (input.productId) params.set('productId', `eq.${input.productId}`);

  const failed = await supabaseRequest<Array<Pick<MediaProcessingJob, 'id'>>>(
    `/rest/v1/media_processing_jobs?${params.toString()}`,
  );
  const ids = failed.map((job) => job.id).filter(Boolean);
  if (ids.length === 0) return { matched: 0, requeued: 0, ids: [] as string[] };

  await supabaseRequest(`/rest/v1/media_processing_jobs?id=${encodeURIComponent(postgrestUuidIn(ids))}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'pending',
      error: null,
      lastStartedAt: null,
      completedAt: null,
    }),
  });

  return { matched: ids.length, requeued: ids.length, ids };
}

export async function getMediaProcessingProduct(productId: string): Promise<MediaProcessingProduct | null> {
  const rows = await supabaseRequest<MediaProcessingProduct[]>(
    `/rest/v1/products?select=id,type,url,thumbnailUrl,watermarkUrl&id=eq.${encodeURIComponent(productId)}&limit=1`,
  );
  return rows[0] || null;
}

export async function updateProductProcessedMedia(
  productId: string,
  changes: Partial<Pick<MediaProcessingProduct, 'thumbnailUrl' | 'watermarkUrl'>>,
) {
  await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(changes),
  });
}

export async function markMediaJobDone(jobId: string, outputUrl?: string | null) {
  await supabaseRequest(`/rest/v1/media_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'done',
      outputUrl: outputUrl || null,
      error: null,
      completedAt: new Date().toISOString(),
    }),
  });
}

export async function markMediaJobFailed(jobId: string, error: string) {
  await supabaseRequest(`/rest/v1/media_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'failed',
      error: error.slice(0, 1000),
    }),
  });
}
