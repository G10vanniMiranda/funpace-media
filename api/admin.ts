import snapshotHandler from '../server/api/admin/snapshot.ts';
import orderStatusHandler from '../server/api/admin/orders/status.ts';
import paymentRecoveryHandler from '../server/api/admin/payments/recovery.ts';

function routeName(req: any) {
  const queryRoute = String(req.query?.route || '').trim();
  if (queryRoute) return queryRoute;

  const url = String(req.url || '');
  if (url.includes('/orders/status')) return 'orders-status';
  if (url.includes('/payments/recovery')) return 'payments-recovery';
  return 'snapshot';
}

export default function handler(req: any, res: any) {
  const route = routeName(req);

  if (route === 'snapshot') return snapshotHandler(req, res);
  if (route === 'orders-status') return orderStatusHandler(req, res);
  if (route === 'payments-recovery') return paymentRecoveryHandler(req, res);

  return res.status(404).json({ error: 'Rota admin nao encontrada.' });
}
