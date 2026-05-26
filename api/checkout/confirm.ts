function setCors(req: any, res: any) {
  const allowedOrigins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function handleOptions(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getSupabaseApiConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role nao configurado nas variaveis de ambiente da Vercel.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
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

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Erro Supabase HTTP ${response.status}`);
  }

  return data as T;
}

function getInfinitePayPaymentCheckEndpoint() {
  return process.env.INFINITEPAY_PAYMENT_CHECK_ENDPOINT ||
    `${(process.env.INFINITEPAY_BASE_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '')}/payment_check`;
}

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
  const returnSource = getBodyValue(body, ['return_source', 'returnSource']);
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

  const successfulCheckoutReturn = normalizeStatus(paymentReturn) === 'success' ||
    normalizeStatus(returnSource) === 'pagamentosucesso';

  const confirmedByCheckoutReturn = !paid &&
    successfulCheckoutReturn &&
    (
      Boolean(captureMethod || transactionNsu) ||
      (
        ['pending', 'failed', 'cancelled'].includes(existingOrder.status) &&
        existingOrder.paymentProvider === 'infinitepay'
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
