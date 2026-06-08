import { assertRequestSize, handleOptions as handleSecurityOptions, publicError, rateLimit, rejectUntrustedBrowserOrigin } from '../_security.js';

type PaymentMethod = 'pix' | 'credit_card' | 'checkout';
type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

type CheckoutProviderResult = {
  provider: string;
  providerPaymentId?: string | null;
  checkoutUrl?: string | null;
  status: PaymentStatus;
  method: PaymentMethod;
  pix?: { qrCode?: string; qrCodeImage?: string; expiresAt?: string } | null;
  rawResponse: any;
};

function createRequestId() {
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logCheckout(level: 'info' | 'error', message: string, detail: Record<string, unknown> = {}) {
  const payload = { source: 'checkout-create-session', message, ...detail };
  if (level === 'error') {
    console.error(payload);
    return;
  }
  console.info(payload);
}

function sanitizeErrorMessage(error: any) {
  return error instanceof Error ? error.message : String(error || 'erro desconhecido');
}

function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');

  if (origin && origins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isTrustedOrigin(req: any) {
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin) return origins.has(origin);

  try {
    const refererOrigin = new URL(String(req.headers.referer || '')).origin.replace(/\/+$/, '');
    return !refererOrigin || origins.has(refererOrigin);
  } catch {
    return true;
  }
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function onlyCpfDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '').slice(0, 11);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizeCouponCode(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

function isValidCartProductId(value: unknown) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !/[(),]/.test(value);
}

function isValidCpf(value: string | null | undefined) {
  const cpf = onlyCpfDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (baseLength: number) => {
    let sum = 0;
    for (let i = 0; i < baseLength; i += 1) {
      sum += Number(cpf[i]) * (baseLength + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calcDigit(9) === Number(cpf[9]) && calcDigit(10) === Number(cpf[10]);
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role não configurado na Vercel.');
  }

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
}

function assertCheckoutEnvironment() {
  const missing = [
    !getInfinitePayHandleSafe() ? 'INFINITEPAY_HANDLE' : '',
    !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL) ? 'SUPABASE_URL' : '',
    !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY) ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw Object.assign(new Error(`Configuracao de checkout incompleta: ${missing.join(', ')}`), { statusCode: 500 });
  }
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

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Erro Supabase HTTP ${response.status}`);
  }

  return data as T;
}

function getInfinitePayCheckoutEndpoint() {
  return process.env.INFINITEPAY_CHECKOUT_ENDPOINT || 'https://api.checkout.infinitepay.io/links';
}

function getInfinitePayHandle() {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) throw new Error('INFINITEPAY_HANDLE não configurado.');
  return handle;
}

function getInfinitePayHandleSafe() {
  return String(process.env.INFINITEPAY_HANDLE || '').trim();
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao chamar serviço externo (${timeoutMs}ms).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertInfinitePayCheckoutUrl(value: string) {
  const parsed = new URL(value);
  const allowedHosts = (process.env.INFINITEPAY_CHECKOUT_ALLOWED_HOSTS || 'infinitepay.io,checkout.infinitepay.io,api.checkout.infinitepay.io')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const hostname = parsed.hostname.toLowerCase();
  const allowed = parsed.protocol === 'https:' && allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

  if (!allowed) {
    throw new Error('InfinitePay retornou uma URL de checkout fora dos dominios permitidos.');
  }
}

function extractCheckoutUrl(payload: any) {
  return String(payload?.url || payload?.link || payload?.checkout_url || payload?.payment_url || '').trim();
}

function extractPix(payload: any) {
  const qrCode = String(payload?.pix?.qr_code || payload?.pix_qr_code || payload?.qr_code || payload?.brcode || '').trim();
  const qrCodeImage = String(payload?.pix?.qr_code_image || payload?.pix_qr_code_image || payload?.qr_code_image || '').trim();
  const expiresAt = String(payload?.pix?.expires_at || payload?.pix_expires_at || payload?.expires_at || '').trim();
  if (!qrCode && !qrCodeImage) return null;
  return { qrCode, qrCodeImage, expiresAt };
}

async function validateCoupon(input: { code: string; subtotal: number; itemCount: number }) {
  const code = normalizeCouponCode(input.code);
  if (!code) return { coupon: null, discountTotal: 0 };
  if (code.length < 3) throw new Error('Cupom inválido.');

  const rows = await supabaseRequest<any[]>(
    `/rest/v1/coupons?select=*&code=eq.${encodeURIComponent(code)}&limit=1`,
  );
  const coupon = rows[0];
  if (!coupon || !coupon.isActive) throw new Error('Cupom inválido ou inativo.');

  const now = Date.now();
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
    throw new Error('Cupom ainda não está válido.');
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    throw new Error('Cupom expirado.');
  }
  if (coupon.maxUses !== null && coupon.maxUses !== undefined && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
    throw new Error('Cupom esgotado.');
  }

  const subtotalCents = Math.round(input.subtotal * 100);
  const minimumTotalCents = Math.max(101, input.itemCount);
  const maxDiscountCents = Math.max(0, subtotalCents - minimumTotalCents);
  const requestedDiscountCents = coupon.type === 'percent'
    ? Math.floor(subtotalCents * Math.min(100, Math.max(0, Number(coupon.value))) / 100)
    : Math.round(Number(coupon.value) * 100);
  const discountCents = Math.min(maxDiscountCents, Math.max(0, requestedDiscountCents));

  if (discountCents <= 0) throw new Error('Cupom não pode ser aplicado a este carrinho.');
  return { coupon, discountTotal: roundMoney(discountCents / 100) };
}

function applyDiscountToProducts(products: any[], discountTotal: number) {
  const discountCents = Math.round(discountTotal * 100);
  if (discountCents <= 0) return products.map((product) => ({ ...product, checkoutPrice: roundMoney(Number(product.price || 0)) }));

  const subtotalCents = products.reduce((sum, product) => sum + Math.round(Number(product.price || 0) * 100), 0);
  let remainingDiscount = discountCents;
  const adjusted = products.map((product, index) => {
    const originalCents = Math.round(Number(product.price || 0) * 100);
    const proportional = index === products.length - 1
      ? remainingDiscount
      : Math.floor(discountCents * originalCents / subtotalCents);
    const itemDiscount = Math.min(Math.max(0, proportional), Math.max(0, originalCents - 1), remainingDiscount);
    remainingDiscount -= itemDiscount;
    return { ...product, checkoutPrice: roundMoney((originalCents - itemDiscount) / 100) };
  });

  for (const product of adjusted) {
    if (remainingDiscount <= 0) break;
    const cents = Math.round(Number(product.checkoutPrice || 0) * 100);
    const extra = Math.min(remainingDiscount, Math.max(0, cents - 1));
    if (extra > 0) {
      product.checkoutPrice = roundMoney((cents - extra) / 100);
      remainingDiscount -= extra;
    }
  }

  return adjusted;
}

function mapStatusFromProvider(payload: any): PaymentStatus {
  if (payload?.paid === true) return 'paid';
  const raw = String(payload?.status || payload?.payment_status || payload?.event || payload?.type || '').toLowerCase();
  if (['paid', 'approved', 'confirmed', 'captured', 'received', 'recebido', 'completed', 'settled', 'success', 'succeeded'].includes(raw)) return 'paid';
  if (['rejected', 'denied', 'refused'].includes(raw)) return 'refused';
  if (['failed', 'expired'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(raw)) return 'canceled';
  if (['refunded', 'chargeback'].includes(raw)) return 'refunded';
  return 'pending';
}

async function createInfinitePayCheckout(input: {
  orderId: string;
  buyer: { fullName: string; email: string; phone?: string; cpf?: string };
  items: { id: string; name: string; price: number }[];
  paymentMethod: PaymentMethod;
  successUrl: string;
  cancelUrl?: string;
  webhookUrl: string;
}): Promise<CheckoutProviderResult> {
  const phoneDigits = String(input.buyer.phone || '').replace(/\D/g, '');
  const payload: any = {
    handle: getInfinitePayHandle(),
    order_nsu: input.orderId,
    redirect_url: input.successUrl,
    webhook_url: input.webhookUrl,
    items: input.items.map((item) => ({
      quantity: 1,
      price: Math.round(Number(item.price) * 100),
      description: `Download digital - ${String(item.name || 'Midia').slice(0, 100)}`,
    })),
    metadata: {
      payment_method_requested: input.paymentMethod,
    },
  };

  if (input.cancelUrl) {
    payload.cancel_url = input.cancelUrl;
  }

  if (phoneDigits.length >= 10) {
    payload.customer = {
      name: String(input.buyer.fullName || '').slice(0, 120),
      email: String(input.buyer.email || '').slice(0, 256),
      phone_number: `+55${phoneDigits}`,
    };
  }

  const response = await fetchWithTimeout(getInfinitePayCheckoutEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, Number(process.env.INFINITEPAY_REQUEST_TIMEOUT_MS || 7000));
  const raw = await response.text();
  let data: any = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || raw || 'Falha ao gerar link na InfinitePay.');
  }

  const checkoutUrl = extractCheckoutUrl(data);
  if (!checkoutUrl) throw new Error('Resposta invalida da InfinitePay ao criar link.');
  assertInfinitePayCheckoutUrl(checkoutUrl);

  return {
    provider: 'infinitepay',
    providerPaymentId: String(data?.id || data?.payment_id || data?.transaction_nsu || data?.slug || '') || null,
    checkoutUrl,
    status: mapStatusFromProvider(data),
    method: input.paymentMethod,
    pix: extractPix(data),
    rawResponse: data,
  };
}

async function createProviderCheckout(input: Parameters<typeof createInfinitePayCheckout>[0]) {
  const provider = String(process.env.PAYMENT_PROVIDER || 'infinitepay').trim().toLowerCase();
  if (provider !== 'infinitepay') {
    throw new Error(`PAYMENT_PROVIDER inválido ou não implementado: ${provider}`);
  }

  return createInfinitePayCheckout(input);
}

async function recordPayment(input: {
  orderId: string;
  provider: string;
  providerPaymentId?: string | null;
  method?: string | null;
  status: PaymentStatus;
  rawResponse?: any;
}) {
  const providerPaymentId = input.providerPaymentId || `${input.provider}:${input.orderId}`;

  await supabaseRequest('/rest/v1/payments?on_conflict=provider,providerPaymentId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      orderId: input.orderId,
      provider: input.provider,
      providerPaymentId,
      method: input.method || 'checkout',
      status: input.status,
      rawResponse: input.rawResponse ?? {},
      updatedAt: new Date().toISOString(),
    }),
  }).catch((error) => {
    console.error('Não foi possível registrar payment:', error);
  });
}

function getAllowedRedirectOrigins(req: any) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return new Set([
    `https://${host}`,
    `${proto}://${host}`,
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
}

function buildSafeSuccessUrl(req: any, inputUrl: string | undefined, orderId: string) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const fallback = `${proto}://${host}/pagamento/sucesso`;
  const candidate = new URL(inputUrl || fallback, fallback);
  const origin = candidate.origin.replace(/\/+$/, '');

  if (!getAllowedRedirectOrigins(req).has(origin)) {
    throw new Error('URL de retorno do checkout não autorizada.');
  }

  candidate.searchParams.set('payment', 'success');
  candidate.searchParams.set('order', orderId);
  return candidate.toString();
}

function buildSafeOptionalRedirectUrl(req: any, inputUrl: string | undefined) {
  if (!inputUrl) return undefined;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const fallback = `${proto}://${host}/`;
  const candidate = new URL(inputUrl, fallback);
  const origin = candidate.origin.replace(/\/+$/, '');

  if (!getAllowedRedirectOrigins(req).has(origin)) {
    throw new Error('URL de cancelamento do checkout não autorizada.');
  }

  return candidate.toString();
}

function getInfinitePayWebhookUrl(req: any) {
  const configuredUrl = String(process.env.INFINITEPAY_WEBHOOK_URL || '').trim();
  if (configuredUrl) return configuredUrl;

  const webhookBaseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  return `${webhookBaseUrl}/api/webhooks/infinitepay`;
}

function getBearerToken(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

export default async function handler(req: any, res: any) {
  const requestId = createRequestId();
  try {
    if (handleSecurityOptions(req, res, 'POST,OPTIONS')) return;
    if (rateLimit(req, res, { keyPrefix: 'checkout', windowMs: 60 * 1000, max: 30 })) return;
    if (rejectUntrustedBrowserOrigin(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método não permitido.', requestId });
    }

    assertCheckoutEnvironment();
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 200 * 1024));
    const { items, successUrl, cancelUrl, buyer, paymentMethod: rawPaymentMethod, couponCode } = getJsonBody(req);
    const authUser = await getAuthenticatedRequestUser(req);
    const paymentMethod: PaymentMethod = rawPaymentMethod === 'pix' || rawPaymentMethod === 'credit_card' ? rawPaymentMethod : 'checkout';

    logCheckout('info', 'request_received', {
      requestId,
      method: req.method,
      itemCount: Array.isArray(items) ? items.length : 0,
      paymentMethod,
      hasCoupon: Boolean(couponCode),
      hasAuth: Boolean(authUser?.id),
    });

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente para iniciar o pagamento.', requestId });
    }

    if (!buyer?.cpf || !isValidCpf(buyer.cpf)) {
      return res.status(400).json({ error: 'CPF valido e obrigatorio para pagamento.', requestId });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: 'Dados do comprador incompletos.', requestId });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio.', requestId });
    }

    const productIds = [...new Set(items.map((item: any) => String(item.id || '').trim()))].filter(Boolean);
    if (productIds.length !== items.length || productIds.some((id) => !isValidCartProductId(id))) {
      return res.status(400).json({ error: 'Carrinho contém produto inválido.', requestId });
    }

    const products = await supabaseRequest<any[]>(
      `/rest/v1/products?select=id,name,price,url,type,vendedorId,bib,event,checkpoint,thumbnailUrl&id=in.(${productIds.join(',')})&status=eq.published`,
    );

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'Um ou mais produtos não estão disponíveis.', requestId });
    }

    const subtotal = roundMoney(products.reduce((sum: number, product: any) => sum + Number(product.price), 0));
    if (subtotal <= 1) {
      return res.status(400).json({ error: 'A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.', requestId });
    }
    let couponResult;
    try {
      couponResult = await validateCoupon({ code: couponCode, subtotal, itemCount: products.length });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Cupom inválido.', requestId });
    }
    const discountTotal = couponResult.discountTotal;
    const total = roundMoney(subtotal - discountTotal);
    const checkoutProducts = applyDiscountToProducts(products, discountTotal);

    const buyerName = String(buyer.fullName).trim();
    const inputBuyerEmail = String(buyer.email).trim().toLowerCase();
    if (authUser.email && inputBuyerEmail && inputBuyerEmail !== authUser.email) {
      return res.status(403).json({ error: 'Use o mesmo e-mail da conta logada para finalizar a compra.', requestId });
    }

    const buyerEmail = authUser.email || inputBuyerEmail;
    const buyerPhone = String(buyer.phone || 'nao_informado').trim();
    const buyerCpf = onlyCpfDigits(buyer.cpf);

    await supabaseRequest('/rest/v1/customers?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: authUser.id,
        email: buyerEmail,
        name: buyerName,
        phone: buyerPhone,
        cpf: buyerCpf,
      }),
    });

    const [order] = await supabaseRequest<any[]>('/rest/v1/orders?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        userId: authUser.id,
        buyerName,
        buyerEmail,
        buyerPhone,
        buyerCpf,
        total,
        subtotal,
        discountTotal,
        status: 'pending',
        paymentMethod,
        paymentProvider: process.env.PAYMENT_PROVIDER || 'infinitepay',
      }),
    });

    const orderId = order?.id;
    if (!orderId) {
      return res.status(500).json({ error: 'Supabase não retornou o ID do pedido.', requestId });
    }

    logCheckout('info', 'order_created', { requestId, orderId, itemCount: checkoutProducts.length, total });

    await supabaseRequest('/rest/v1/order_items', {
      method: 'POST',
      body: JSON.stringify(checkoutProducts.map((product: any) => ({
        orderId,
        productId: product.id,
        name: product.name,
        type: product.type,
        price: product.checkoutPrice,
        url: product.url,
        vendedorId: product.vendedorId,
        bib: product.bib,
        event: product.event,
        checkpoint: product.checkpoint,
        thumbnailUrl: product.thumbnailUrl,
      }))),
    });

    const successRedirectUrl = buildSafeSuccessUrl(req, successUrl, orderId);
    const cancelRedirectUrl = buildSafeOptionalRedirectUrl(req, typeof cancelUrl === 'string' ? cancelUrl : undefined);
    let paymentResult;
    try {
      paymentResult = await createProviderCheckout({
        orderId,
        buyer: {
          fullName: buyerName,
          email: buyerEmail,
          phone: buyerPhone,
          cpf: buyerCpf,
        },
        items: checkoutProducts.map((product: any) => ({
          id: product.id,
          name: product.name,
          price: Number(product.checkoutPrice),
        })),
        paymentMethod,
        successUrl: successRedirectUrl,
        cancelUrl: cancelRedirectUrl,
        webhookUrl: getInfinitePayWebhookUrl(req),
      });
    } catch (error: any) {
      logCheckout('error', 'provider_checkout_failed', {
        requestId,
        orderId,
        provider: 'infinitepay',
        error: sanitizeErrorMessage(error),
      });
      await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed' }),
      }).catch(() => undefined);

      return res.status(502).json({
        error: error?.message || 'Falha ao gerar checkout com infinitepay.',
        code: 'PAYMENT_PROVIDER_FAILED',
        requestId,
      });
    }

    await recordPayment({
      orderId,
      provider: paymentResult.provider,
      providerPaymentId: paymentResult.providerPaymentId || orderId,
      method: paymentResult.method,
      status: paymentResult.status,
      rawResponse: paymentResult.rawResponse,
    });

    await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        checkoutUrl: paymentResult.checkoutUrl,
        paymentExternalId: paymentResult.providerPaymentId,
        paymentProvider: paymentResult.provider,
      }),
    });

    if (couponResult.coupon) {
      const nextUsedCount = Number(couponResult.coupon.usedCount || 0) + 1;
      await supabaseRequest(`/rest/v1/coupons?id=eq.${couponResult.coupon.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ usedCount: nextUsedCount }),
      }).catch((error) => {
        console.error('Não foi possível atualizar uso do cupom:', error);
      });
    }

    logCheckout('info', 'checkout_created', {
      requestId,
      orderId,
      provider: paymentResult.provider,
      status: paymentResult.status,
      hasCheckoutUrl: Boolean(paymentResult.checkoutUrl),
    });

    return res.status(200).json({
      url: paymentResult.checkoutUrl,
      paymentUrl: paymentResult.checkoutUrl,
      orderId,
      total,
      subtotal,
      discountTotal,
      couponCode: couponResult.coupon?.code || null,
      paymentMethod,
      provider: paymentResult.provider,
      status: paymentResult.status,
      pix: paymentResult.pix || null,
      requestId,
    });
  } catch (error: any) {
    logCheckout('error', 'handler_failed', {
      requestId,
      statusCode: Number(error?.statusCode || 500),
      error: sanitizeErrorMessage(error),
    });
    const safe = publicError(error, 'Erro interno ao criar checkout.');
    return res.status(safe.statusCode).json({
      error: safe.message,
      code: 'CHECKOUT_CREATE_SESSION_FAILED',
      requestId,
      source: 'checkout-create-session',
    });
  }
}
