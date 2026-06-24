import { assertRequestSize, handleOptions as handleSecurityOptions, rateLimit, setSecurityHeaders } from '../../server/shared/security.js';
import { fulfillPaidOrder } from '../../server/shared/checkoutFulfillment.js';

type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

function setCors(res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

async function getRawBody(req: any) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

async function isWebhookAuthorized(req: any) {
  const secret = process.env.INFINITEPAY_WEBHOOK_SECRET || process.env.INFINITEPAY_WEBHOOK_TOKEN || '';
  const authMode = String(process.env.INFINITEPAY_WEBHOOK_REQUIRE_AUTH || '').trim().toLowerCase();
  const requireAuth = authMode === 'true' || (process.env.NODE_ENV === 'production' && authMode !== 'false');
  if (!requireAuth) return true;
  if (!secret) return false;

  const direct = String(
    req.headers?.['x-webhook-secret'] ||
    req.headers?.['x-infinitepay-token'] ||
    req.headers?.['x-infinitepay-secret'] ||
    '',
  );
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (direct === secret || bearer === secret) return true;

  const signature = String(
    req.headers?.['x-infinitepay-signature'] ||
    req.headers?.['x-webhook-signature'] ||
    req.headers?.['x-signature'] ||
    '',
  );
  if (!signature) return false;

  const { createHmac, timingSafeEqual } = await import('crypto');
  const rawBody = await getRawBody(req);
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalized = signature.replace(/^sha256=/i, '');

  try {
    return timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getPayloadValue(payload: any, names: string[]) {
  const wanted = new Set(names.map(normalizeKey));
  const queue = [payload];
  const seen = new Set<any>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
      if (value && typeof value === 'object') queue.push(value);
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

async function recordPaymentEvent(input: { eventId: string; orderId: string; status: string; payload: any }) {
  await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'infinitepay',
      eventId: input.eventId,
      orderId: input.orderId,
      status: input.status,
      payload: input.payload,
    }),
  }).catch((error) => console.error('webhook:event_record_failed', error));
}

async function recordPayment(input: { orderId: string; providerPaymentId: string; method: string; status: PaymentStatus; rawResponse: any }) {
  await supabaseRequest('/rest/v1/payments?on_conflict=provider,providerPaymentId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      orderId: input.orderId,
      provider: 'infinitepay',
      providerPaymentId: input.providerPaymentId,
      method: input.method || 'checkout',
      status: input.status,
      rawResponse: input.rawResponse,
      updatedAt: new Date().toISOString(),
    }),
  });

  await supabaseRequest(`/rest/v1/payments?orderId=eq.${encodeURIComponent(input.orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: input.status, updatedAt: new Date().toISOString() }),
  }).catch((error) => console.error('webhook:payment_rollup_failed', error));
}

async function releaseDownloadAccess(orderId: string) {
  const orders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,userId,buyerEmail,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];
  if (!order || order.status !== 'paid') return;

  const items = await supabaseRequest<any[]>(
    `/rest/v1/order_items?select=id,orderId,productId,vendedorId,price&orderId=eq.${encodeURIComponent(orderId)}`,
  );
  if (!items.length) return;

  const expiresAt = new Date(Date.now() + Number(process.env.DOWNLOAD_ACCESS_DAYS || 30) * 24 * 60 * 60 * 1000).toISOString();
  await supabaseRequest('/rest/v1/download_access?on_conflict=orderId,photoId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(items.map((item) => ({
      orderId,
      photoId: item.productId,
      orderItemId: item.id,
      userId: order.userId || null,
      customerEmail: order.buyerEmail,
      isActive: true,
      expiresAt,
    }))),
  });

  const existing = await supabaseRequest<any[]>(
    `/rest/v1/photographer_transactions?select=orderItemId&orderId=eq.${encodeURIComponent(orderId)}`,
  ).catch(() => []);
  const processed = new Set(existing.map((item) => String(item.orderItemId || '')));
  const newItems = items.filter((item) => !processed.has(String(item.id)));
  if (!newItems.length) return;

  const settings = await supabaseRequest<any[]>('/rest/v1/platform_settings?select=platformFeePercent&id=eq.default&limit=1').catch(() => []);
  const feePercent = Number(settings[0]?.platformFeePercent ?? 30);
  await supabaseRequest('/rest/v1/photographer_transactions?on_conflict=orderItemId', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(newItems.map((item) => {
      const grossAmount = Number(item.price || 0);
      const platformFee = Number((grossAmount * feePercent / 100).toFixed(2));
      const netAmount = Number(Math.max(0, grossAmount - platformFee).toFixed(2));
      return {
        photographerId: item.vendedorId,
        orderId,
        orderItemId: item.id,
        grossAmount,
        platformFee,
        netAmount,
        status: 'pending',
      };
    })),
  }).catch((error) => console.error('webhook:photographer_transactions_failed', error));
}

function normalizePaymentMethod(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('card') || normalized.includes('credit') || normalized.includes('credito')) return 'credit_card';
  return 'checkout';
}

export default async function handler(req: any, res: any) {
  if (handleSecurityOptions(req, res, 'POST,OPTIONS', 'Content-Type, Authorization, X-Webhook-Secret, X-InfinitePay-Token, X-InfinitePay-Signature, X-Webhook-Signature, X-Signature')) return;
  setSecurityHeaders(res);
  if (rateLimit(req, res, { keyPrefix: 'webhook-infinitepay', windowMs: 60 * 1000, max: 240 })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    assertRequestSize(req, Number(process.env.WEBHOOK_MAX_BODY_BYTES || 200 * 1024));
    if (!(await isWebhookAuthorized(req))) {
      return res.status(401).json({ success: false, received: false, error: 'Webhook não autorizado.' });
    }

    const payload = getJsonBody(req);
    const orderId = getPayloadValue(payload, ['order_nsu', 'orderNSU', 'order', 'order_id', 'orderId', 'reference', 'external_reference']);
    const transactionNsu = getPayloadValue(payload, ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu']);
    const slug = getPayloadValue(payload, ['invoice_slug', 'invoiceSlug', 'slug', 'invoice_id', 'invoiceId']);
    const eventId = getPayloadValue(payload, ['id', 'event_id', 'eventId']) || `${orderId}:${transactionNsu || slug || Date.now()}`;
    const payloadStatus = mapPaymentCheckStatus(payload);

    if (!isUuid(orderId)) {
      return res.status(400).json({ success: false, received: false, error: 'Pedido invalido no webhook.' });
    }
    if (!transactionNsu || !slug) {
      await recordPaymentEvent({
        eventId,
        orderId,
        status: payloadStatus,
        payload: {
          ...payload,
          webhook_warning: 'missing_transaction_or_slug',
          requires_admin_recovery: payloadStatus === 'paid',
          hasTransactionNsu: Boolean(transactionNsu),
          hasSlug: Boolean(slug),
        },
      });
      await recordPayment({
        orderId,
        providerPaymentId: transactionNsu || `infinitepay:${orderId}:missing-identifiers`,
        method: normalizePaymentMethod(getPayloadValue(payload, ['capture_method', 'payment_method', 'method'])),
        status: payloadStatus,
        rawResponse: {
          ...payload,
          webhook_warning: 'missing_transaction_or_slug',
          requires_admin_recovery: payloadStatus === 'paid',
        },
      }).catch((error) => console.error('webhook:payment_record_missing_identifiers_failed', error));
      return res.status(202).json({
        success: true,
        received: true,
        orderId,
        status: payloadStatus,
        requiresAdminRecovery: payloadStatus === 'paid',
      warning: 'Webhook sem transaction_nsu ou invoice_slug; evento registrado para recuperação.',
      });
    }

    const checked = await checkInfinitePayPayment({ orderId, transactionNsu, slug });
    const status = checked.status;
    const rawResponse = { ...payload, payment_check: checked.rawResponse };

    await recordPaymentEvent({ eventId, orderId, status, payload: rawResponse });
    await recordPayment({
      orderId,
      providerPaymentId: transactionNsu,
      method: normalizePaymentMethod(getPayloadValue(payload, ['capture_method', 'payment_method', 'method'])),
      status,
      rawResponse,
    });

    if (status === 'paid') {
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
    } else if (['failed', 'cancelled', 'canceled', 'refused', 'refunded'].includes(status)) {
      await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paymentProvider=eq.infinitepay&status=neq.paid`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status,
          paymentExternalId: transactionNsu,
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    return res.status(200).json({ success: true, received: true, orderId, status });
  } catch (error: any) {
    console.error('webhook:infinitepay_failed', error);
    return res.status(400).json({
      success: false,
      received: false,
      error: error?.message || 'Falha ao processar webhook InfinitePay.',
    });
  }
}
