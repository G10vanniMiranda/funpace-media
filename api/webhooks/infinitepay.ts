import {
  getInfinitePayPaymentCheckEndpoint,
  getJsonBody,
  handleOptions,
  isUuid,
  setCors,
  supabaseRequest,
} from '../_utils';

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getPayloadValue(payload: any, names: string[]) {
  const normalizedNames = new Set(names.map(normalizeKey));
  const queue = [payload];
  const seen = new Set<any>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (normalizedNames.has(normalizeKey(key)) && value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }

      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return '';
}

function mapPaymentStatus(payload: any, paid: boolean) {
  if (paid) return 'paid';

  const rawStatus = getPayloadValue(payload, [
    'status',
    'payment_status',
    'paymentStatus',
    'event',
    'type',
  ]).toLowerCase();

  if (['paid', 'approved', 'completed', 'confirmed', 'payment_approved'].includes(rawStatus)) return 'paid';
  if (['failed', 'rejected', 'denied', 'expired'].includes(rawStatus)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(rawStatus)) return 'cancelled';
  if (['refunded', 'chargeback'].includes(rawStatus)) return 'refunded';
  return 'pending';
}

function getWebhookEventId(payload: any, orderId: string, status: string, transactionNsu: string) {
  return getPayloadValue(payload, [
    'id',
    'event_id',
    'eventId',
    'transaction_nsu',
    'transactionNSU',
    'transaction_id',
    'transactionId',
    'invoice_slug',
    'invoiceSlug',
    'slug',
  ]) || `${orderId}:${transactionNsu || status}`;
}

async function checkInfinitePayPayment(input: {
  handle: string;
  orderId: string;
  transactionNsu: string;
  slug: string;
}) {
  const response = await fetch(getInfinitePayPaymentCheckEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: input.handle,
      order_nsu: input.orderId,
      transaction_nsu: input.transactionNsu,
      slug: input.slug,
    }),
  });

  const raw = await response.text();
  let payload: any = {};

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || raw || `InfinitePay HTTP ${response.status}`);
  }

  return payload;
}

async function recordPaymentEvent(input: {
  eventId: string;
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
        eventId: input.eventId,
        orderId: input.orderId,
        status: input.status,
        payload: input.payload,
      }),
    });
  } catch (error) {
    console.error('Nao foi possivel registrar evento InfinitePay:', error);
  }
}

async function updateOrderStatus(input: {
  orderId: string;
  status: string;
  transactionNsu: string;
}) {
  if (input.status === 'paid') {
    await supabaseRequest(`/rest/v1/orders?id=eq.${input.orderId}&status=in.(pending,failed,cancelled)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paid',
        paymentExternalId: input.transactionNsu || null,
      }),
    });
    return;
  }

  if (['failed', 'cancelled', 'refunded'].includes(input.status)) {
    await supabaseRequest(`/rest/v1/orders?id=eq.${input.orderId}&status=neq.paid`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: input.status,
        paymentExternalId: input.transactionNsu || null,
      }),
    });
  }
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  const payload = getJsonBody(req);
  const orderId = getPayloadValue(payload, [
    'order_nsu',
    'orderNSU',
    'order',
    'order_id',
    'orderId',
    'reference',
    'external_reference',
  ]);
  const transactionNsu = getPayloadValue(payload, [
    'transaction_nsu',
    'transactionNSU',
    'transaction_id',
    'transactionId',
    'nsu',
  ]);
  const slug = getPayloadValue(payload, [
    'invoice_slug',
    'invoiceSlug',
    'slug',
    'invoice_id',
    'invoiceId',
  ]);

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Pedido invalido no webhook.' });
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
  }

  if (!transactionNsu || !slug) {
    await recordPaymentEvent({
      eventId: getWebhookEventId(payload, orderId, 'pending', transactionNsu),
      orderId,
      status: 'pending',
      payload: { ...payload, webhook_error: 'missing_transaction_or_slug' },
    });

    return res.status(200).json({
      received: true,
      orderId,
      status: 'pending',
      message: 'Dados de pagamento incompletos no webhook.',
      missing: {
        transaction_nsu: !transactionNsu,
        invoice_slug: !slug,
      },
    });
  }

  let paymentCheck: any = {};
  try {
    paymentCheck = await checkInfinitePayPayment({ handle, orderId, transactionNsu, slug });
  } catch (error: any) {
    await recordPaymentEvent({
      eventId: getWebhookEventId(payload, orderId, 'pending', transactionNsu),
      orderId,
      status: 'pending',
      payload: { ...payload, payment_check_error: error?.message || 'payment_check_failed' },
    });

    return res.status(502).json({ error: error?.message || 'Falha ao validar webhook na InfinitePay.' });
  }

  const status = mapPaymentStatus(payload, Boolean(paymentCheck?.paid));
  const eventId = getWebhookEventId(payload, orderId, status, transactionNsu);

  await recordPaymentEvent({
    eventId,
    orderId,
    status,
    payload: { ...payload, payment_check: paymentCheck },
  });

  await updateOrderStatus({ orderId, status, transactionNsu });

  return res.status(200).json({ received: true, orderId, status });
}
