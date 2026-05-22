import { createPool, getInfinitePayPaymentCheckEndpoint, handleOptions, isUuid, setCors } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  const orderId = String(req.body?.order || req.body?.order_nsu || '');
  const transactionNsu = String(req.body?.transaction_nsu || req.body?.transactionNSU || '');
  const slug = String(req.body?.slug || req.body?.invoice_slug || '');

  if (!handle) {
    return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Pedido invalido.' });
  }

  if (!transactionNsu || !slug) {
    return res.status(400).json({ error: 'Dados de confirmacao do pagamento incompletos.' });
  }

  const paymentCheckResponse = await fetch(getInfinitePayPaymentCheckEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle,
      order_nsu: orderId,
      transaction_nsu: transactionNsu,
      slug,
    }),
  });

  if (!paymentCheckResponse.ok) {
    const message = await paymentCheckResponse.text();
    return res.status(502).json({ error: message || 'Falha ao confirmar pagamento na InfinitePay.' });
  }

  const paymentCheck: any = await paymentCheckResponse.json().catch(() => ({}));

  if (!paymentCheck?.paid) {
    return res.status(409).json({ paid: false, message: 'Pagamento ainda nao confirmado.' });
  }

  const pool = createPool();
  try {
    await pool.query(
      `
        update public.orders
        set status = 'paid', "paymentExternalId" = coalesce($1, "paymentExternalId")
        where id = $2
          and status in ('pending', 'failed', 'cancelled')
      `,
      [transactionNsu, orderId],
    );
  } finally {
    await pool.end().catch(() => undefined);
  }

  return res.status(200).json({ paid: true });
}
