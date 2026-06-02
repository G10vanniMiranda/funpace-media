import healthHandler from '../server/api/health.ts';
import checkoutDebugHandler from '../server/api/checkout/debug.ts';
import paymentsReconcileHandler from '../server/api/payments/reconcile.ts';

function routeName(req: any) {
  const queryRoute = String(req.query?.route || '').trim();
  if (queryRoute) return queryRoute;

  const url = String(req.url || '');
  if (url.includes('/checkout/debug')) return 'checkout-debug';
  if (url.includes('/payments/reconcile')) return 'payments-reconcile';
  return 'health';
}

export default function handler(req: any, res: any) {
  const route = routeName(req);

  if (route === 'health') return healthHandler(req, res);
  if (route === 'checkout-debug') return checkoutDebugHandler(req, res);
  if (route === 'payments-reconcile') return paymentsReconcileHandler(req, res);

  return res.status(404).json({ error: 'Rota operacional nao encontrada.' });
}
