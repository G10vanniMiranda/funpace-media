import { getInfinitePayPaymentCheckEndpoint, getJsonBody, handleOptions, isUuid, setCors, supabaseRequest } from '../_utils';

function normalizeStatus(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

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

function hasFailureReturn(body: any) {
  const values = [
    getBodyValue(body, ['payment']),
    getBodyValue(body, ['status', 'payment_status', 'paymentStatus']),
    getBodyValue(body, ['event', 'type']),
  ].map(normalizeStatus).filter(Boolean);

  return values.some((value) => [
    'cancel',
    'cancelled',
    'canceled',
    'failed',
    'failure',
    'rejected',
    'denied',
    'expired',
    'refunded',
    'chargeback',
  ].includes(value));
}

async function recordPaymentEvent(input: {
  orderId: string;
  status: string;
  payload: any;
}) {
  try {
    await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        provider: 'infinitepay',
        eventId: `${input.orderId}:checkout-confirm:${Date.now()}`,
        orderId: input.orderId,
        status: input.status,
        payload: input.payload,
      }),
    });
  } catch (error) {
    console.error('Nao foi possivel registrar confirmacao InfinitePay:', error);
  }
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
  const failureReturn = hasFailureReturn(body);

  if (!handle) {
    return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Pedido invalido.' });
  }

  const existingOrders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,status,paymentProvider,paymentExternalId,checkoutUrl&id=eq.${encodeURIComponent(orderId)}&limit=1`,
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

  if (failureReturn) {
    await recordPaymentEvent({
      orderId,
      status: 'cancelled',
      payload: {
        source: 'checkout-confirm',
        reason: 'failure_return',
        raw_query: body?.raw_query || {},
        body,
      },
    });

    return res.status(409).json({
      paid: false,
      message: 'Retorno de pagamento nao aprovado.',
      source: 'checkout-confirm',
      reason: 'failure_return',
    });
  }

  let paid = false;
  let paymentCheckError = '';
  let paymentCheck: any = {};
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
        paymentCheck = await paymentCheckResponse.json().catch(() => ({}));
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
    (
      Boolean(captureMethod || transactionNsu) ||
      (
        existingOrder.status === 'pending' &&
        existingOrder.paymentProvider === 'infinitepay' &&
        Boolean(existingOrder.checkoutUrl)
      )
    );

  if (!paid && !confirmedByCheckoutReturn) {
    await recordPaymentEvent({
      orderId,
      status: 'pending',
      payload: {
        source: 'checkout-confirm',
        reason: !transactionNsu && !captureMethod && !slug ? 'missing_confirmation_params' : 'payment_check_unpaid',
        paymentCheckError,
        payment_check: paymentCheck,
        raw_query: body?.raw_query || {},
        body,
      },
    });

    return res.status(409).json({
      paid: false,
      message: 'Pagamento ainda nao confirmado.',
      source: 'checkout-confirm',
      reason: !transactionNsu && !captureMethod && !slug ? 'missing_confirmation_params' : 'payment_check_unpaid',
      paymentCheckError,
    });
  }

  const confirmedBy = paid ? 'payment_check' : 'checkout_return';
  await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}&status=in.(pending,failed,cancelled)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      paymentExternalId: transactionNsu || existingOrder.paymentExternalId,
    }),
  });

  await recordPaymentEvent({
    orderId,
    status: 'paid',
    payload: {
      source: 'checkout-confirm',
      confirmedBy,
      payment_check: paymentCheck,
      raw_query: body?.raw_query || {},
      body,
    },
  });

  return res.status(200).json({ paid: true, confirmedBy });
}
