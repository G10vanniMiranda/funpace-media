import snapshotHandler from '../server/api/admin/snapshot.ts';
import orderStatusHandler from '../server/api/admin/orders/status.ts';
import paymentRecoveryHandler from '../server/api/admin/payments/recovery.ts';

function getClientIp(req: any) {
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim() ||
    String(req.socket?.remoteAddress || req.connection?.remoteAddress || '');
}

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
  return 'snapshot';
}

export default function handler(req: any, res: any) {
  if (!isIpAllowed(req)) {
    return res.status(403).json({ error: 'IP nao autorizado para rotas administrativas.' });
  }

  const route = routeName(req);

  if (route === 'snapshot') return snapshotHandler(req, res);
  if (route === 'orders-status') return orderStatusHandler(req, res);
  if (route === 'payments-recovery') return paymentRecoveryHandler(req, res);

  return res.status(404).json({ error: 'Rota admin nao encontrada.' });
}
