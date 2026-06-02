import { infinitePayProvider } from '../../server/payments/providers/infinitepay.ts';
import { fulfillPaidOrder, recordPayment } from '../../server/shared/checkoutFulfillment.ts';
import { supabaseRequest } from '../../server/shared/utils.ts';

function isAuthorized(req: any) {
  const secret = process.env.CRON_SECRET || process.env.PAYMENTS_RECONCILE_SECRET || '';
  if (!secret && process.env.NODE_ENV !== 'production') return true;
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return Boolean(secret && bearer === secret);
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
    const urls = [source?.checkoutUrl, source?.url, source?.link, source?.checkout_url, source?.payment_url].filter(Boolean);
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

async function recordPaymentEvent(orderId: string, status: string, payload: any) {
  await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'infinitepay',
      eventId: `${orderId}:auto-reconcile`,
      orderId,
      status,
      payload,
    }),
  }).catch((error) => {
    console.error('payments:reconcile:event_failed', orderId, error?.message || error);
  });
}

async function loadContext(order: any) {
  const [payments, events] = await Promise.all([
    supabaseRequest<any[]>(`/rest/v1/payments?select=*&orderId=eq.${encodeURIComponent(order.id)}&provider=eq.infinitepay&order=updatedAt.desc.nullslast,createdAt.desc&limit=20`).catch(() => []),
    supabaseRequest<any[]>(`/rest/v1/payment_events?select=*&orderId=eq.${encodeURIComponent(order.id)}&provider=eq.infinitepay&order=createdAt.desc&limit=20`).catch(() => []),
  ]);
  return { payments, events };
}

async function reconcileOrder(order: any) {
  const { payments, events } = await loadContext(order);
  const identifiers = extractPaymentIdentifiers(
    order,
    ...payments.map((payment) => payment.rawResponse || {}),
    ...events.map((eventItem) => eventItem.payload || {}),
  );

  if (!identifiers.transactionNsu || !identifiers.slug) {
    await recordPaymentEvent(order.id, 'pending', {
      source: 'payments_reconcile_cron',
      reason: 'missing_transaction_or_slug',
      hasTransactionNsu: Boolean(identifiers.transactionNsu),
      hasSlug: Boolean(identifiers.slug),
    });
    return { orderId: order.id, action: 'skipped', reason: 'missing_transaction_or_slug' };
  }

  const checked = await infinitePayProvider.checkPayment({
    orderId: order.id,
    transactionNsu: identifiers.transactionNsu,
    slug: identifiers.slug,
  });
  const status = checked.status;

  if (status === 'paid') {
    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&paymentProvider=eq.infinitepay&status=in.(pending,failed,cancelled,canceled,refused)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'paid', paymentExternalId: identifiers.transactionNsu }),
    });
    await recordPayment({
      orderId: order.id,
      provider: 'infinitepay',
      providerPaymentId: identifiers.transactionNsu,
      method: order.paymentMethod || 'checkout',
      status,
      rawResponse: { source: 'payments_reconcile_cron', payment_check: checked.rawResponse },
    });
    await recordPaymentEvent(order.id, status, {
      source: 'payments_reconcile_cron',
      transactionNsu: identifiers.transactionNsu,
      slug: identifiers.slug,
      payment_check: checked.rawResponse,
    });
    await fulfillPaidOrder(order.id);
    return { orderId: order.id, action: 'paid' };
  }

  await recordPayment({
    orderId: order.id,
    provider: 'infinitepay',
    providerPaymentId: identifiers.transactionNsu,
    method: order.paymentMethod || 'checkout',
    status,
    rawResponse: { source: 'payments_reconcile_cron', payment_check: checked.rawResponse },
  });
  await recordPaymentEvent(order.id, status, {
    source: 'payments_reconcile_cron',
    transactionNsu: identifiers.transactionNsu,
    slug: identifiers.slug,
    payment_check: checked.rawResponse,
  });
  return { orderId: order.id, action: 'checked', status };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }

  const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);
  const minAgeMinutes = Math.max(Number(req.query?.minAgeMinutes || 5), 0);
  const olderThan = new Date(Date.now() - minAgeMinutes * 60 * 1000).toISOString();

  try {
    const orders = await supabaseRequest<any[]>(
      `/rest/v1/orders?select=*&paymentProvider=eq.infinitepay&status=eq.pending&createdAt=lte.${encodeURIComponent(olderThan)}&order=createdAt.asc&limit=${limit}`,
    );
    const results = [];
    for (const order of orders) {
      try {
        results.push(await reconcileOrder(order));
      } catch (error: any) {
        console.error('payments:reconcile:error', order.id, error?.message || error);
        await recordPaymentEvent(order.id, 'pending', {
          source: 'payments_reconcile_cron',
          error: error?.message || String(error),
        });
        results.push({ orderId: order.id, action: 'failed', error: error?.message || String(error) });
      }
    }

    return res.status(200).json({
      checked: orders.length,
      paid: results.filter((result) => result.action === 'paid').length,
      skipped: results.filter((result) => result.action === 'skipped').length,
      failed: results.filter((result) => result.action === 'failed').length,
      results,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro na reconciliacao de pagamentos.' });
  }
}
