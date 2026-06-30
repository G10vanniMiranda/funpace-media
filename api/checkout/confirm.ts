import { assertRequestSize, handleOptions as handleSecurityOptions, publicError, rateLimitAsync, rejectUntrustedBrowserOrigin } from '../../server/shared/security.js';
import { fulfillPaidOrder, recordPayment } from '../../server/shared/checkoutFulfillment.js';

type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getBodyValue(body: any, names: string[]) {
  const rawQuery = body?.raw_query && typeof body.raw_query === 'object' ? body.raw_query : {};
  for (const name of names) {
    const value = body?.[name] ?? rawQuery?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }

  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(rawQuery)) {
    if (lowerNames.has(String(key).toLowerCase()) && value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase Service Role não configurado.');
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) throw new Error(data?.message || data?.hint || raw || `Supabase HTTP ${response.status}`);
  return data as T;
}

function getInfinitePayHandle() {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) throw new Error('INFINITEPAY_HANDLE não configurado.');
  return handle;
}

function getPaymentCheckEndpoint() {
  return process.env.INFINITEPAY_PAYMENT_CHECK_ENDPOINT ||
    `${(process.env.INFINITEPAY_BASE_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '')}/payment_check`;
}

function mapPaymentCheckStatus(payload: any): PaymentStatus {
  if (payload?.paid === true) return 'paid';
  const raw = String(payload?.status || payload?.payment_status || payload?.event || payload?.type || '').toLowerCase();
  if (['paid', 'approved', 'confirmed', 'captured', 'received', 'recebido', 'completed', 'settled', 'success', 'succeeded'].includes(raw)) return 'paid';
  if (['rejected', 'denied', 'refused'].includes(raw)) return 'refused';
  if (['failed', 'expired'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(raw)) return 'canceled';
  if (['refunded', 'chargeback'].includes(raw)) return 'refunded';
  return 'pending';
}

async function checkInfinitePayPayment(input: { orderId: string; transactionNsu: string; slug: string }) {
  const response = await fetch(getPaymentCheckEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: getInfinitePayHandle(),
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
  if (!response.ok) throw new Error(payload?.message || payload?.error || raw || `InfinitePay HTTP ${response.status}`);
  return { status: mapPaymentCheckStatus(payload), rawResponse: payload };
}

async function recordPaymentEvent(input: { orderId: string; status: string; payload: any }) {
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
  }).catch((error) => console.error('confirm:event_record_failed', error));
}

function normalizePaymentMethod(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('card') || normalized.includes('credit') || normalized.includes('credito')) return 'credit_card';
  return 'checkout';
}

export default async function handler(req: any, res: any) {
  if (handleSecurityOptions(req, res, 'POST,OPTIONS')) return;
  if (await rateLimitAsync(req, res, { keyPrefix: 'checkout-confirm', windowMs: 60 * 1000, max: 60 })) return;
  if (rejectUntrustedBrowserOrigin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 200 * 1024));
    const body = getJsonBody(req);
    const orderId = getBodyValue(body, ['order', 'order_nsu', 'orderNsu', 'orderNSU', 'order_id', 'orderId']);
    const transactionNsu = getBodyValue(body, ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu']);
    const slug = getBodyValue(body, ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId']);
    const captureMethod = getBodyValue(body, ['capture_method', 'captureMethod', 'payment_method', 'paymentMethod']);

    if (!isUuid(orderId)) {
      return res.status(400).json({ paid: false, error: 'Pedido inválido.' });
    }

    const orders = await supabaseRequest<any[]>(
      `/rest/v1/orders?select=id,status,paymentProvider,paymentExternalId,checkoutUrl&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    const order = orders[0];
    if (!order) return res.status(404).json({ paid: false, error: 'Pedido não encontrado.' });
    if (order.paymentProvider !== 'infinitepay') {
      return res.status(409).json({ paid: false, error: 'Pedido não pertence ao provedor InfinitePay.' });
    }

    if (order.status === 'paid') {
      await fulfillPaidOrder(orderId);
      return res.status(200).json({ paid: true, confirmedBy: 'order_status' });
    }

    if (!transactionNsu || !slug) {
      await recordPaymentEvent({
        orderId,
        status: 'pending',
        payload: {
          source: 'checkout-confirm',
          reason: 'missing_confirmation_params',
          body,
        },
      });
      return res.status(409).json({
        paid: false,
        message: 'Pagamento ainda não confirmado.',
        reason: 'missing_confirmation_params',
      });
    }

    const checked = await checkInfinitePayPayment({ orderId, transactionNsu, slug });
    const status = checked.status;
    const rawResponse = { source: 'checkout-confirm', body, payment_check: checked.rawResponse };

    await recordPayment({
      orderId,
      provider: 'infinitepay',
      providerPaymentId: transactionNsu,
      method: normalizePaymentMethod(captureMethod),
      status,
      rawResponse,
    });
    await recordPaymentEvent({ orderId, status, payload: rawResponse });

    if (status !== 'paid') {
      return res.status(409).json({ paid: false, message: 'Pagamento ainda não confirmado.', status });
    }

    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paymentProvider=eq.infinitepay&status=in.(pending,failed,cancelled,canceled,refused)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paid',
        paymentExternalId: transactionNsu,
        updatedAt: new Date().toISOString(),
      }),
    });

    await fulfillPaidOrder(orderId);
    return res.status(200).json({ paid: true, confirmedBy: 'payment_check' });
  } catch (error: any) {
    console.error('confirm:infinitepay_failed', error);
    const safe = publicError(error, 'Não foi possível confirmar o pagamento.');
    return res.status(safe.statusCode).json({
      paid: false,
      error: safe.message,
    });
  }
}
