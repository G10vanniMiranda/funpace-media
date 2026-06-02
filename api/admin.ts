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

function setCors(res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!isIpAllowed(req)) {
    return res.status(403).json({ error: 'IP nao autorizado para rotas administrativas.' });
  }

  const route = routeName(req);

  if (route === 'snapshot') {
    const { default: snapshotHandler } = await import('../server/api/admin/snapshot.ts');
    return snapshotHandler(req, res);
  }

  if (route === 'orders-status') {
    const { default: orderStatusHandler } = await import('../server/api/admin/orders/status.ts');
    return orderStatusHandler(req, res);
  }

  if (route === 'payments-recovery') {
    const { default: paymentRecoveryHandler } = await import('../server/api/admin/payments/recovery.ts');
    return paymentRecoveryHandler(req, res);
  }

  return res.status(404).json({ error: 'Rota admin nao encontrada.' });
}
