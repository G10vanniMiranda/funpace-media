import { infinitePayProvider } from '../../../payments/providers/infinitepay.js';
import { fulfillPaidOrder, recordPayment } from '../../../shared/checkoutFulfillment.js';

type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getBearerToken(req: any) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Service Role não configurado.');
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey, anonKey };
}

async function getAuthenticatedAdminUser(req: any) {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin' ? user : null;
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
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

function extractPaymentIdentifiers(...sources: any[]) {
  const transactionNames = ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu', 'payment_id', 'paymentId'];
  const slugNames = ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId'];
  let transactionNsu = '';
  let slug = '';

  for (const source of sources) {
    if (!transactionNsu) transactionNsu = getPayloadValue(source, transactionNames);
    if (!slug) slug = getPayloadValue(source, slugNames);
  }

  for (const source of sources) {
    const urls = [
      source?.checkoutUrl,
      source?.url,
      source?.link,
      source?.checkout_url,
      source?.payment_url,
    ].filter(Boolean);
    for (const url of urls) {
      try {
        const parsed = new URL(String(url));
        if (!transactionNsu) transactionNsu = transactionNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
        if (!slug) slug = slugNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
      } catch {
        // Ignore invalid provider URLs.
      }
    }
  }

  return { transactionNsu, slug };
}

async function recordPaymentEvent(input: {
  orderId: string;
  status: string;
  eventId: string;
  payload: any;
}) {
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
  });
}

async function recordAdminLog(input: {
  actorId?: string;
  actorEmail?: string;
  action: string;
  targetId: string;
  metadata: any;
}) {
  await supabaseRequest('/rest/v1/admin_activity_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      actorId: input.actorId || null,
      actorEmail: input.actorEmail || null,
      action: input.action,
      targetType: 'order',
      targetId: input.targetId,
      metadata: input.metadata,
    }),
  }).catch((error) => {
    console.error('Não foi possível registrar log admin de pagamento:', error);
  });
}

async function loadOrderContext(orderId: string) {
  const [orders, payments, events, items, access] = await Promise.all([
    supabaseRequest<any[]>(`/rest/v1/orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`),
    supabaseRequest<any[]>(`/rest/v1/payments?select=*&orderId=eq.${encodeURIComponent(orderId)}&order=updatedAt.desc.nullslast,createdAt.desc`),
    supabaseRequest<any[]>(`/rest/v1/payment_events?select=*&orderId=eq.${encodeURIComponent(orderId)}&order=createdAt.desc&limit=25`),
    supabaseRequest<any[]>(`/rest/v1/order_items?select=*&orderId=eq.${encodeURIComponent(orderId)}&order=createdAt.asc`),
    supabaseRequest<any[]>(`/rest/v1/download_access?select=*&orderId=eq.${encodeURIComponent(orderId)}`),
  ]);
  return { order: orders[0], payments, events, items, access };
}

function buildIssue(context: { order: any; payments: any[]; events: any[]; items: any[]; access: any[] }) {
  const { order, payments, events, items, access } = context;
  const paidPayments = payments.filter((payment) => payment.status === 'paid');
  const paidEvents = events.filter((event) => event.status === 'paid');
  const missingAccessCount = Math.max(0, items.length - access.filter((row) => row.isActive !== false).length);
  const identifiers = extractPaymentIdentifiers(order, ...payments.map((payment) => payment.rawResponse || {}), ...events.map((event) => event.payload || {}));
  const reasons: string[] = [];

  if (order?.status !== 'paid' && paidPayments.length > 0) reasons.push('payment_paid_order_not_paid');
  if (order?.status !== 'paid' && paidEvents.length > 0) reasons.push('webhook_paid_order_not_paid');
  if (order?.status === 'paid' && missingAccessCount > 0) reasons.push('paid_order_missing_download_access');
  if (order?.status === 'pending' && payments.some((payment) => payment.status === 'pending') && events.length === 0) reasons.push('pending_without_webhook');
  if (!identifiers.transactionNsu || !identifiers.slug) reasons.push('missing_provider_identifiers');

  return {
    orderId: order.id,
    status: order.status,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    total: Number(order.total || 0),
    paymentMethod: order.paymentMethod,
    paymentProvider: order.paymentProvider,
    paymentExternalId: order.paymentExternalId,
    createdAt: order.createdAt,
    itemCount: items.length,
    accessCount: access.length,
    missingAccessCount,
    paymentStatuses: payments.map((payment) => payment.status),
    eventStatuses: events.map((event) => event.status).filter(Boolean),
    hasTransactionNsu: Boolean(identifiers.transactionNsu),
    hasSlug: Boolean(identifiers.slug),
    reasons,
  };
}

async function listIssues() {
  const orders = await supabaseRequest<any[]>('/rest/v1/orders?select=*&paymentProvider=eq.infinitepay&order=createdAt.desc&limit=5000');
  const issues = [];

  for (const order of orders) {
    const context = await loadOrderContext(order.id);
    const issue = buildIssue(context);
    if (issue.reasons.length > 0) issues.push(issue);
  }

  return issues;
}

async function reprocessOrder(orderId: string, actor: any) {
  const context = await loadOrderContext(orderId);
  if (!context.order) throw new Error('Pedido não encontrado.');

  const identifiers = extractPaymentIdentifiers(
    context.order,
    ...context.payments.map((payment) => payment.rawResponse || {}),
    ...context.events.map((event) => event.payload || {}),
  );

  if (!identifiers.transactionNsu || !identifiers.slug) {
    await recordPaymentEvent({
      orderId,
      status: 'pending',
      eventId: `${orderId}:admin-reprocess:missing-identifiers`,
      payload: {
        source: 'admin_payment_recovery',
        action: 'reprocess',
        reason: 'missing_transaction_or_slug',
        hasTransactionNsu: Boolean(identifiers.transactionNsu),
        hasSlug: Boolean(identifiers.slug),
      },
    });
    throw new Error('Não há transaction_nsu e slug suficientes para consultar a InfinitePay. Use liberação manual somente com comprovante externo.');
  }

  const checked = await infinitePayProvider.checkPayment({
    orderId,
    transactionNsu: identifiers.transactionNsu,
    slug: identifiers.slug,
  });
  const status = checked.status as PaymentStatus;

  if (status === 'paid') {
    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paymentProvider=eq.infinitepay&status=in.(pending,failed,cancelled,canceled,refused)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paid',
        paymentExternalId: identifiers.transactionNsu,
      }),
    });
  } else if (['failed', 'cancelled', 'canceled', 'refused', 'refunded'].includes(status)) {
    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paymentProvider=eq.infinitepay&status=neq.paid`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        paymentExternalId: identifiers.transactionNsu,
      }),
    });
  }

  await recordPayment({
    orderId,
    provider: 'infinitepay',
    providerPaymentId: identifiers.transactionNsu,
    method: context.order.paymentMethod || 'checkout',
    status,
    rawResponse: {
      source: 'admin_payment_recovery',
      action: 'reprocess',
      payment_check: checked.rawResponse,
    },
  });
  await recordPaymentEvent({
    orderId,
    status,
    eventId: `${orderId}:admin-reprocess:${identifiers.transactionNsu}`,
    payload: {
      source: 'admin_payment_recovery',
      action: 'reprocess',
      transactionNsu: identifiers.transactionNsu,
      slug: identifiers.slug,
      payment_check: checked.rawResponse,
    },
  });

  if (status === 'paid') await fulfillPaidOrder(orderId);
  await recordAdminLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'payment_reprocess',
    targetId: orderId,
    metadata: { status, transactionNsu: identifiers.transactionNsu },
  });

  return { orderId, status };
}

async function manuallyReleaseOrder(orderId: string, reason: string, actor: any) {
  if (!reason || reason.length < 8) {
    throw new Error('Informe um motivo/comprovante externo para liberacao manual.');
  }

  const context = await loadOrderContext(orderId);
  if (!context.order) throw new Error('Pedido não encontrado.');
  if (context.items.length === 0) throw new Error('Pedido sem itens; não há downloads para liberar.');

  const providerPaymentId = context.order.paymentExternalId || `manual:${orderId}`;
  await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paymentProvider=eq.infinitepay`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      paymentExternalId: providerPaymentId,
    }),
  });
  await recordPayment({
    orderId,
    provider: 'infinitepay',
    providerPaymentId,
    method: context.order.paymentMethod || 'checkout',
    status: 'paid',
    rawResponse: {
      source: 'admin_payment_recovery',
      action: 'manual_release',
      reason,
      actorId: actor.id,
      actorEmail: actor.email,
    },
  });
  await recordPaymentEvent({
    orderId,
    status: 'paid',
    eventId: `${orderId}:manual-release`,
    payload: {
      source: 'admin_payment_recovery',
      action: 'manual_release',
      reason,
      actorId: actor.id,
      actorEmail: actor.email,
    },
  });
  await fulfillPaidOrder(orderId);
  await recordAdminLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'payment_manual_release',
    targetId: orderId,
    metadata: { reason, providerPaymentId },
  });

  return { orderId, status: 'paid' };
}

async function fulfillOnly(orderId: string, actor: any) {
  const context = await loadOrderContext(orderId);
  if (!context.order) throw new Error('Pedido não encontrado.');
  if (context.order.status !== 'paid') throw new Error('Apenas pedidos pagos podem ter fulfillment reexecutado.');

  await fulfillPaidOrder(orderId);
  await recordAdminLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'payment_fulfillment_retry',
    targetId: orderId,
    metadata: { source: 'admin_payment_recovery' },
  });

  return { orderId, status: 'paid' };
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) return res.status(403).json({ error: 'Acesso admin não autorizado.' });

    if (req.method === 'GET') {
      const issues = await listIssues();
      return res.status(200).json({
        issues,
        summary: {
          total: issues.length,
          pendingWithoutWebhook: issues.filter((issue) => issue.reasons.includes('pending_without_webhook')).length,
          missingProviderIdentifiers: issues.filter((issue) => issue.reasons.includes('missing_provider_identifiers')).length,
          missingDownloadAccess: issues.filter((issue) => issue.reasons.includes('paid_order_missing_download_access')).length,
        },
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

    const body = getJsonBody(req);
    const action = String(body.action || '').trim();
    const orderId = String(body.orderId || '').trim();
    const reason = String(body.reason || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Pedido obrigatorio.' });

    if (action === 'reprocess') {
      const result = await reprocessOrder(orderId, adminUser);
      return res.status(200).json(result);
    }

    if (action === 'manual_release') {
      const result = await manuallyReleaseOrder(orderId, reason, adminUser);
      return res.status(200).json(result);
    }

    if (action === 'fulfill') {
      const result = await fulfillOnly(orderId, adminUser);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Acao invalida.' });
  } catch (error: any) {
    const message = error?.message || 'Erro na recuperação de pagamento.';
    const status = /transaction_nsu|slug|comprovante|Apenas pedidos pagos/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
