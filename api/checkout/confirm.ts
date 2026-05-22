import { getInfinitePayPaymentCheckEndpoint, getJsonBody, handleOptions, isUuid, setCors, supabaseRequest } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  const body = getJsonBody(req);
  const handle = process.env.INFINITEPAY_HANDLE;
  const orderId = String(body?.order || body?.order_nsu || '');
  const transactionNsu = String(body?.transaction_nsu || body?.transactionNSU || body?.transaction_id || body?.transactionId || '');
  const slug = String(body?.slug || body?.invoice_slug || '');
  const captureMethod = String(body?.capture_method || body?.captureMethod || '');

  if (!handle) {
    return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Pedido invalido.' });
  }

  if (!transactionNsu || (!slug && !captureMethod)) {
    return res.status(400).json({ error: 'Dados de confirmacao do pagamento incompletos.' });
  }

  let paid = false;
  if (slug) {
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

    if (paymentCheckResponse.ok) {
      const paymentCheck: any = await paymentCheckResponse.json().catch(() => ({}));
      paid = Boolean(paymentCheck?.paid);
    }
  }

  if (!paid && !captureMethod) {
    return res.status(409).json({ paid: false, message: 'Pagamento ainda nao confirmado.' });
  }

  await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}&status=in.(pending,failed,cancelled)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      paymentExternalId: transactionNsu,
    }),
  });

  return res.status(200).json({ paid: true, confirmedBy: paid ? 'payment_check' : 'checkout_return' });
}
