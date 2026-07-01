import healthHandler from '../server/api/health.js';
import checkoutDebugHandler from '../server/api/checkout/debug.js';
import eventMediaCountsHandler from '../server/api/events/media-counts.js';
import directUploadHandler from '../server/api/media/direct-upload.js';
import mediaJobsHandler from '../server/api/media/jobs.js';
import paymentsReconcileHandler from '../server/api/payments/reconcile.js';
import { handleOptions, rateLimitAsync, setSecurityHeaders } from '../server/shared/security.js';

function routeName(req: any) {
  const queryRoute = String(req.query?.route || '').trim();
  if (queryRoute) return queryRoute;

  const url = String(req.url || '');
  if (url.includes('/checkout/debug')) return 'checkout-debug';
  if (url.includes('/events/media-counts')) return 'events-media-counts';
  if (url.includes('/media/direct-upload')) return 'media-direct-upload';
  if (url.includes('/media/jobs')) return 'media-jobs';
  if (url.includes('/payments/reconcile')) return 'payments-reconcile';
  if (url.includes('/downloads/authorize')) return 'downloads-authorize';
  return 'health';
}

export default async function handler(req: any, res: any) {
  const route = routeName(req);

  if (route === 'downloads-authorize') {
    const { default: downloadAuthorizeHandler } = await import('../server/api/downloads/authorize.js');
    return downloadAuthorizeHandler(req, res);
  }

  if (handleOptions(req, res, 'GET,POST,OPTIONS')) return;
  if (await rateLimitAsync(req, res, { keyPrefix: 'system', windowMs: 60 * 1000, max: 120 })) return;
  setSecurityHeaders(res);

  if (route === 'health') {
    if (process.env.ENABLE_PUBLIC_DIAGNOSTICS !== 'true') {
      return res.status(200).json({ ok: true, time: new Date().toISOString() });
    }
    return healthHandler(req, res);
  }

  if (route === 'events-media-counts') return eventMediaCountsHandler(req, res);
  if (route === 'media-direct-upload') return directUploadHandler(req, res);

  const secret = process.env.CRON_SECRET || process.env.OPERATIONS_SECRET || '';
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (secret && bearer !== secret) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  if (route === 'checkout-debug') return checkoutDebugHandler(req, res);
  if (route === 'media-jobs') return mediaJobsHandler(req, res);
  if (route === 'payments-reconcile') return paymentsReconcileHandler(req, res);

  return res.status(404).json({ error: 'Rota operacional não encontrada.' });
}
