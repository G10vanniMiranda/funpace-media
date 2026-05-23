import { getInfinitePayPaymentCheckEndpoint, getJsonBody, handleOptions, isUuid, setCors, supabaseRequest } from '../_utils';

function getBodyValue(body: any, names: string[]) {
  const rawQuery = body?.raw_query && typeof body.raw_query === 'object' ? body.raw_query : {};

  for (const name of names) {
    const value = body?.[name] ?? rawQuery?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(rawQuery)) {
    if (lowerNames.has(String(key).toLowerCase()) && value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  const body = getJsonBody(req);
  const handle = process.env.INFINITEPAY_HANDLE;
  const orderId = getBodyValue(body, ['order', 'order_nsu', 'orderNsu', 'orderNSU', 'order_id', 'orderId']);
  const transactionNsu = getBodyValue(body, ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu']);
  const slug = getBodyValue(body, ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId']);
  const captureMethod = getBodyValue(body, ['capture_method', 'captureMethod', 'payment_method', 'paymentMethod']);
  const paymentReturn = getBodyValue(body, ['payment']);

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
  if (transactionNsu && slug) {
    try {
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
    } catch (error: any) {
      paymentCheckError = error?.message || 'Falha ao confirmar pagamento na InfinitePay.';
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
