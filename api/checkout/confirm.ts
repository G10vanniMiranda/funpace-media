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
  const paymentReturn = String(body?.payment || '');

  if (!handle) {
    return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Pedido invalido.' });
  }

  const existingOrders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,status,paymentExternalId&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const existingOrder = existingOrders[0];

  if (!existingOrder) {
    return res.status(404).json({ error: 'Pedido nao encontrado.' });
  }

  if (existingOrder.status === 'paid') {
    return res.status(200).json({
      paid: true,
      confirmedBy: 'order_status',
      paymentExternalId: existingOrder.paymentExternalId,
    });
  }

  let paid = false;
  let paymentCheckError = '';
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
    } else {
      paymentCheckError = await paymentCheckResponse.text().catch(() => '');
    }
  }

  const confirmedByCheckoutReturn = !paid &&
    paymentReturn === 'success' &&
    Boolean(captureMethod || transactionNsu);

  if (!paid && !confirmedByCheckoutReturn) {
    return res.status(409).json({
      paid: false,
      message: 'Pagamento ainda nao confirmado.',
      source: 'checkout-confirm',
      reason: !transactionNsu && !captureMethod && !slug ? 'missing_confirmation_params' : 'payment_check_unpaid',
      paymentCheckError,
    });
  }

  await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}&status=in.(pending,failed,cancelled)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      paymentExternalId: transactionNsu || existingOrder.paymentExternalId,
    }),
  });

  return res.status(200).json({ paid: true, confirmedBy: paid ? 'payment_check' : 'checkout_return' });
}
