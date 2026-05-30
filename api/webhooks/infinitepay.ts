import {
  getJsonBody,
  handleOptions,
  isUuid,
  setCors,
  supabaseRequest,
} from '../../server/shared/utils.ts';
import { createHmac, timingSafeEqual } from 'crypto';
import { infinitePayProvider } from '../../server/payments/providers/infinitepay.ts';
import { fulfillPaidOrder, recordPayment } from '../../server/shared/checkoutFulfillment.ts';

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

function mapNonPaidPaymentStatus(payload: any) {
  const rawStatus = getPayloadValue(payload, [
    'status',
    'payment_status',
    'paymentStatus',
    'event',
    'type',
  ]).toLowerCase();

  if (['rejected', 'denied', 'refused'].includes(rawStatus)) return 'refused';
  if (['failed', 'expired'].includes(rawStatus)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(rawStatus)) return 'canceled';
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

function getWebhookSignature(req: any) {
  return String(req.headers?.['x-infinitepay-signature'] || req.headers?.['x-webhook-signature'] || req.headers?.['x-signature'] || '');
}

function getWebhookToken(req: any) {
  return String(req.headers?.['x-infinitepay-token'] || req.headers?.['x-webhook-token'] || req.query?.token || '');
}

function isValidWebhookSignature(req: any, payload: any) {
  const secret = process.env.INFINITEPAY_WEBHOOK_SECRET || process.env.INFINITEPAY_WEBHOOK_TOKEN || '';
  if (!secret) return true;

  const token = getWebhookToken(req);
  if (token && token === secret) return true;

  const signature = getWebhookSignature(req).replace(/^sha256=/i, '').trim();
  if (!signature) return false;

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(payload);
  const digest = createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

function normalizePaymentMethod(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('card') || normalized.includes('credit') || normalized.includes('credito')) return 'credit_card';
  return 'checkout';
}

async function updateOrderStatus(input: {
  orderId: string;
  status: string;
  transactionNsu: string;
}) {
  if (input.status === 'paid') {
    await supabaseRequest(`/rest/v1/orders?id=eq.${input.orderId}&paymentProvider=eq.infinitepay&status=in.(pending,failed,cancelled,canceled,refused)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paid',
        paymentExternalId: input.transactionNsu || null,
      }),
    });
    return;
  }

  if (['failed', 'cancelled', 'canceled', 'refused', 'refunded'].includes(input.status)) {
    await supabaseRequest(`/rest/v1/orders?id=eq.${input.orderId}&paymentProvider=eq.infinitepay&status=neq.paid`, {
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
  if (!isValidWebhookSignature(req, payload)) {
    return res.status(401).json({ error: 'Assinatura do webhook invalida.' });
  }

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
  let status = mapNonPaidPaymentStatus(payload);
  try {
    const checked = await infinitePayProvider.checkPayment({ orderId, transactionNsu, slug });
    paymentCheck = checked.rawResponse;
    status = checked.status;
  } catch (error: any) {
    await recordPaymentEvent({
      eventId: getWebhookEventId(payload, orderId, 'pending', transactionNsu),
      orderId,
      status: 'pending',
      payload: { ...payload, payment_check_error: error?.message || 'payment_check_failed' },
    });

    return res.status(502).json({ error: error?.message || 'Falha ao validar webhook na InfinitePay.' });
  }

  const eventId = getWebhookEventId(payload, orderId, status, transactionNsu);

  await recordPaymentEvent({
    eventId,
    orderId,
    status,
    payload: { ...payload, payment_check: paymentCheck },
  });

  await updateOrderStatus({ orderId, status, transactionNsu });
  await recordPayment({
    orderId,
    provider: 'infinitepay',
    providerPaymentId: transactionNsu || eventId,
    method: normalizePaymentMethod(getPayloadValue(payload, ['capture_method', 'payment_method', 'method'])),
    status: status as any,
    rawResponse: { ...payload, payment_check: paymentCheck },
  });

  if (status === 'paid') {
    await fulfillPaidOrder(orderId);
  }

  return res.status(200).json({ received: true, orderId, status });
}
