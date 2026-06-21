import { getClientIp, handleOptions, rateLimit, rejectUntrustedBrowserOrigin } from '../server/shared/security.js';

function isIpAllowed(req: any) {
  const allowlist = String(process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.includes(getClientIp(req));
}

function routeName(req: any) {
  const queryRoute = String(req.query?.route || '').trim();
  if (queryRoute) return queryRoute;

  const url = String(req.url || '');
  if (url.includes('/orders/status')) return 'orders-status';
  if (url.includes('/payments/recovery')) return 'payments-recovery';
  if (url.includes('/photographers/')) return 'photographers-action';
  return 'snapshot';
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res, 'GET,POST,PATCH,OPTIONS')) return;
  if (rateLimit(req, res, { keyPrefix: 'admin', windowMs: 60 * 1000, max: 60 })) return;
  if (rejectUntrustedBrowserOrigin(req, res)) return;

  if (!isIpAllowed(req)) {
    return res.status(403).json({ error: 'IP não autorizado para rotas administrativas.' });
  }

  const route = routeName(req);

  if (route === 'snapshot') {
    const { default: snapshotHandler } = await import('../server/api/admin/snapshot.js');
    return snapshotHandler(req, res);
  }

  if (route === 'orders-status') {
    const { default: orderStatusHandler } = await import('../server/api/admin/orders/status.js');
    return orderStatusHandler(req, res);
  }

  if (route === 'payments-recovery') {
    const { default: paymentRecoveryHandler } = await import('../server/api/admin/payments/recovery.js');
    return paymentRecoveryHandler(req, res);
  }

  if (route === 'photographers-action') {
    const { default: photographerActionHandler } = await import('../server/api/admin/photographers/action.js');
    return photographerActionHandler(req, res);
  }

  return res.status(404).json({ error: 'Rota admin não encontrada.' });
}
