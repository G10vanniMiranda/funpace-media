import { publicError, setSecurityHeaders } from '../../shared/security.js';
import { supabaseRequest } from '../../shared/utils.js';
import { runMediaProcessingWorker } from '../../media/media-processing-worker.js';
import { requeueFailedMediaJobs } from '../../media/media-job-repository.js';

type MediaProcessingJob = {
  id: string;
  productId: string | null;
  photographerId: string;
  kind: string;
  status: string;
  sourceUrl: string | null;
  outputUrl: string | null;
  error: string | null;
  attempts?: number;
  lastStartedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

function bearerToken(req: any) {
  return String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function hasOperationsAccess(req: any) {
  const secret = process.env.OPERATIONS_SECRET || process.env.CRON_SECRET || '';
  return Boolean(secret && bearerToken(req) === secret);
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function summarizeJobs(rows: MediaProcessingJob[]) {
  const byStatus = new Map<string, number>();
  const byKind = new Map<string, number>();
  const byKindStatus = new Map<string, number>();

  for (const row of rows) {
    increment(byStatus, row.status || 'unknown');
    increment(byKind, row.kind || 'unknown');
    increment(byKindStatus, `${row.kind || 'unknown'}:${row.status || 'unknown'}`);
  }

  return {
    total: rows.length,
    byStatus: Object.fromEntries(byStatus),
    byKind: Object.fromEntries(byKind),
    byKindStatus: Object.fromEntries(byKindStatus),
  };
}

function requestedAction(req: any) {
  const action = String(req.query?.action || req.body?.action || '').trim().toLowerCase();
  if (action) return action;

  const url = String(req.url || '').toLowerCase();
  if (url.includes('/media/jobs/process')) return 'process';
  if (url.includes('/media/jobs/reprocess-failed')) return 'reprocess-failed';
  return '';
}

export default async function mediaJobsHandler(req: any, res: any) {
  setSecurityHeaders(res);

  if (!hasOperationsAccess(req)) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }

  if (!['GET', 'POST'].includes(String(req.method || '').toUpperCase())) {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const method = String(req.method || '').toUpperCase();
    const action = requestedAction(req);
    const isDedicatedProcessRoute = String(req.url || '').toLowerCase().includes('/media/jobs/process');
    if ((method === 'POST' || isDedicatedProcessRoute) && ['process', 'run', 'worker'].includes(action)) {
      const result = await runMediaProcessingWorker();
      return res.status(200).json({
        ok: true,
        worker: {
          enabled: true,
          mode: 'claim-and-process',
        },
        result,
      });
    }

    if (String(req.method || '').toUpperCase() === 'POST' && ['reprocess-failed', 'retry-failed', 'requeue-failed'].includes(action)) {
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit || req.body?.limit || 50)));
      const productId = String(req.query?.productId || req.body?.productId || '').trim() || null;
      const result = await requeueFailedMediaJobs({ limit, productId });
      return res.status(200).json({
        ok: true,
        action: 'reprocess-failed',
        result,
        next: result.requeued > 0 ? 'POST /api/media/jobs?action=process' : null,
      });
    }

    const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || req.body?.limit || 250)));
    const rows = await supabaseRequest<MediaProcessingJob[]>(
      `/rest/v1/media_processing_jobs?select=*&order=createdAt.desc&limit=${limit}`,
    );
    const pending = rows.filter((row) => row.status === 'pending').slice(0, 50);
    const failed = rows.filter((row) => row.status === 'failed').slice(0, 50);

    return res.status(200).json({
      ok: true,
      limit,
      summary: summarizeJobs(rows),
      pending,
      failed,
      worker: {
        enabled: true,
        trigger: 'POST /api/media/jobs?action=process',
        retryFailedTrigger: 'POST /api/media/jobs?action=reprocess-failed',
        externalProcessorEnabled: process.env.MEDIA_PROCESSOR_ENABLED === 'true',
        reason: 'Worker transacional ativo para claim/status/retry e reprocessamento de falhas.',
      },
    });
  } catch (error: any) {
    const safe = publicError(error, 'Nao foi possivel consultar a fila de midia.');
    return res.status(safe.statusCode).json({ error: safe.message });
  }
}
