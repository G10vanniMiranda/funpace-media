import healthHandler from '../server/api/health.js';
import checkoutDebugHandler from '../server/api/checkout/debug.js';
import paymentsReconcileHandler from '../server/api/payments/reconcile.js';
import { handleOptions, rateLimit, setSecurityHeaders } from './_security.js';

function routeName(req: any) {
  const queryRoute = String(req.query?.route || '').trim();
  if (queryRoute) return queryRoute;

  const url = String(req.url || '');
  if (url.includes('/checkout/debug')) return 'checkout-debug';
  if (url.includes('/payments/reconcile')) return 'payments-reconcile';
  return 'health';
}

export default function handler(req: any, res: any) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) return;
  if (rateLimit(req, res, { keyPrefix: 'system', windowMs: 60 * 1000, max: 120 })) return;
  setSecurityHeaders(res);

  const route = routeName(req);

  if (route === 'health') {
    if (process.env.ENABLE_PUBLIC_DIAGNOSTICS !== 'true') {
      return res.status(200).json({ ok: true, time: new Date().toISOString() });
    }
    return healthHandler(req, res);
  }

  const secret = process.env.CRON_SECRET || process.env.OPERATIONS_SECRET || '';
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (secret && bearer !== secret) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  if (route === 'checkout-debug') return checkoutDebugHandler(req, res);
  if (route === 'payments-reconcile') return paymentsReconcileHandler(req, res);

  return res.status(404).json({ error: 'Rota operacional não encontrada.' });
}
