import 'dotenv/config';

const dryRun = !process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const minAgeArg = process.argv.find((arg) => arg.startsWith('--min-age-minutes='));
const limit = Math.min(Math.max(Number(limitArg?.split('=')[1] || 50), 1), 500);
const minAgeMinutes = Math.max(Number(minAgeArg?.split('=')[1] || 15), 0);

function requireEnv(name, fallbackNames = []) {
  const value = [name, ...fallbackNames].map((key) => process.env[key]).find((item) => String(item || '').trim());
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return String(value).trim();
}

const supabaseUrl = requireEnv('SUPABASE_URL', ['NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY']);
const infinitePayHandle = requireEnv('INFINITEPAY_HANDLE');
const paymentCheckEndpoint = (
  process.env.INFINITEPAY_PAYMENT_CHECK_ENDPOINT ||
  `${(process.env.INFINITEPAY_BASE_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '')}/payment_check`
);
const requestTimeoutMs = Number(process.env.INFINITEPAY_REQUEST_TIMEOUT_MS || 7000);

async function supabaseRequest(path, init = {}) {
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
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Supabase HTTP ${response.status}`);
  }
  return data;
}

async function fetchWithTimeout(input, init = {}, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao chamar servico externo (${timeoutMs}ms).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapStatusFromPayload(payload) {
  if (payload?.paid === true) return 'paid';
  const raw = String(payload?.status || payload?.payment_status || payload?.event || payload?.type || '').toLowerCase();
  if (['paid', 'approved', 'confirmed', 'captured', 'received', 'recebido', 'completed', 'settled', 'success', 'succeeded'].includes(raw)) return 'paid';
  if (['rejected', 'denied', 'refused'].includes(raw)) return 'refused';
  if (['failed', 'expired'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(raw)) return 'canceled';
  if (['refunded', 'chargeback'].includes(raw)) return 'refunded';
  return 'pending';
}

function firstValue(source, names) {
  if (!source || typeof source !== 'object') return '';
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  for (const value of Object.values(source)) {
    if (value && typeof value === 'object') {
      const nested = firstValue(value, names);
      if (nested) return nested;
    }
  }
  return '';
}

function extractPaymentIdentifiers(...sources) {
  const transactionNames = ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu', 'payment_id', 'paymentId'];
  const slugNames = ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId'];
  let transactionNsu = '';
  let slug = '';

  for (const source of sources) {
    if (!transactionNsu) transactionNsu = firstValue(source, transactionNames);
    if (!slug) slug = firstValue(source, slugNames);
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
        if (!transactionNsu) {
          transactionNsu = transactionNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
        }
        if (!slug) {
          slug = slugNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
        }
      } catch {
        // Ignore invalid URLs saved by older providers.
      }
    }
  }

  return { transactionNsu, slug };
}

async function checkInfinitePayPayment(orderId, transactionNsu, slug) {
  const response = await fetchWithTimeout(paymentCheckEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: infinitePayHandle,
      order_nsu: orderId,
      transaction_nsu: transactionNsu,
      slug,
    }),
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || raw || `InfinitePay HTTP ${response.status}`);
  }
  return { status: mapStatusFromPayload(payload), rawResponse: payload };
}

async function recordPayment(orderId, providerPaymentId, status, rawResponse) {
  await supabaseRequest('/rest/v1/payments?on_conflict=provider,providerPaymentId', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      orderId,
      provider: 'infinitepay',
      providerPaymentId: providerPaymentId || `infinitepay:${orderId}`,
      method: 'checkout',
      status,
      rawResponse,
      updatedAt: new Date().toISOString(),
    }),
  }).catch((error) => {
    console.error('reconcile:payment_record_failed', orderId, error?.message || error);
  });
}

async function recordPaymentEvent(orderId, status, payload) {
  await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'infinitepay',
      eventId: `${orderId}:reconcile:${Date.now()}`,
      orderId,
      status,
      payload,
    }),
  }).catch((error) => {
    console.error('reconcile:event_record_failed', orderId, error?.message || error);
  });
}

async function releaseDownloadAccess(orderId) {
  const orders = await supabaseRequest(
    `/rest/v1/orders?select=id,userId,buyerEmail,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];
  if (!order || order.status !== 'paid') return;

  const items = await supabaseRequest(
    `/rest/v1/order_items?select=id,orderId,productId&orderId=eq.${encodeURIComponent(orderId)}`,
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
}

async function registerPhotographerTransactions(orderId) {
  const settingsRows = await supabaseRequest('/rest/v1/platform_settings?select=platformFeePercent&id=eq.default&limit=1').catch(() => []);
  const feePercent = Number(settingsRows[0]?.platformFeePercent ?? 30);
  const items = await supabaseRequest(
    `/rest/v1/order_items?select=id,orderId,productId,vendedorId,price&orderId=eq.${encodeURIComponent(orderId)}`,
  ).catch(() => []);
  if (!items.length) return;

  const existingTransactions = await supabaseRequest(
    `/rest/v1/photographer_transactions?select=orderItemId&orderId=eq.${encodeURIComponent(orderId)}`,
  ).catch(() => []);
  const processedItemIds = new Set(existingTransactions.map((transaction) => String(transaction.orderItemId || '')));
  const newItems = items.filter((item) => !processedItemIds.has(String(item.id)));
  if (!newItems.length) return;

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
  });

  for (const item of newItems) {
    const rows = await supabaseRequest(
      `/rest/v1/products?select=salesCount&id=eq.${encodeURIComponent(item.productId)}&limit=1`,
    ).catch(() => []);
    const nextSalesCount = Number(rows[0]?.salesCount || 0) + 1;
    await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(item.productId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ salesCount: nextSalesCount }),
    }).catch(() => undefined);
  }
}

async function fulfillPaidOrder(orderId) {
  await releaseDownloadAccess(orderId);
  await registerPhotographerTransactions(orderId);
}

async function loadPendingOrders() {
  const olderThan = new Date(Date.now() - minAgeMinutes * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    select: 'id,status,paymentProvider,paymentExternalId,checkoutUrl,createdAt,updatedAt',
    paymentProvider: 'eq.infinitepay',
    status: 'eq.pending',
    createdAt: `lte.${olderThan}`,
    order: 'createdAt.asc',
    limit: String(limit),
  });
  return supabaseRequest(`/rest/v1/orders?${query.toString()}`);
}

async function loadPaymentContext(orderId) {
  const [payments, events] = await Promise.all([
    supabaseRequest(
      `/rest/v1/payments?select=providerPaymentId,rawResponse,createdAt,updatedAt&orderId=eq.${encodeURIComponent(orderId)}&provider=eq.infinitepay&order=updatedAt.desc.nullslast,createdAt.desc&limit=10`,
    ).catch(() => []),
    supabaseRequest(
      `/rest/v1/payment_events?select=status,payload,createdAt&orderId=eq.${encodeURIComponent(orderId)}&provider=eq.infinitepay&order=createdAt.desc&limit=10`,
    ).catch(() => []),
  ]);
  return { payments, events };
}

async function reconcileOrder(order) {
  const { payments, events } = await loadPaymentContext(order.id);
  const paymentRawResponses = payments.map((payment) => payment.rawResponse || {});
  const eventPayloads = events.map((event) => event.payload || {});
  const { transactionNsu, slug } = extractPaymentIdentifiers(
    order,
    ...paymentRawResponses,
    ...eventPayloads,
  );

  if (!transactionNsu || !slug) {
    if (!dryRun) {
      await recordPaymentEvent(order.id, 'pending', {
        source: 'reconcile-infinitepay-pending-orders',
        dryRun,
        reason: 'missing_transaction_or_slug',
        hasTransactionNsu: Boolean(transactionNsu),
        hasSlug: Boolean(slug),
      });
    }
    return { orderId: order.id, action: 'skipped', reason: 'missing_transaction_or_slug' };
  }

  const checked = await checkInfinitePayPayment(order.id, transactionNsu, slug);
  const payload = {
    source: 'reconcile-infinitepay-pending-orders',
    dryRun,
    transactionNsu,
    slug,
    payment_check: checked.rawResponse,
  };

  if (dryRun) {
    return { orderId: order.id, action: 'checked', status: checked.status };
  }

  if (checked.status === 'paid') {
    await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&paymentProvider=eq.infinitepay&status=eq.pending`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'paid',
          paymentExternalId: transactionNsu,
        }),
      },
    );
    await recordPayment(order.id, transactionNsu, 'paid', payload);
    await recordPaymentEvent(order.id, 'paid', payload);
    await fulfillPaidOrder(order.id);
    return { orderId: order.id, action: 'paid', status: checked.status };
  }

  if (['failed', 'cancelled', 'canceled', 'refused', 'refunded'].includes(checked.status)) {
    await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&paymentProvider=eq.infinitepay&status=eq.pending`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: checked.status,
          paymentExternalId: transactionNsu,
        }),
      },
    );
  }

  await recordPayment(order.id, transactionNsu, checked.status, payload);
  await recordPaymentEvent(order.id, checked.status, payload);
  return { orderId: order.id, action: 'updated', status: checked.status };
}

async function main() {
  console.log('reconcile:start', { dryRun, limit, minAgeMinutes });
  const orders = await loadPendingOrders();
  console.log('reconcile:orders', { count: orders.length });

  const summary = { checked: 0, paid: 0, updated: 0, skipped: 0, failed: 0 };
  for (const order of orders) {
    try {
      const result = await reconcileOrder(order);
      summary[result.action] = (summary[result.action] || 0) + 1;
      console.log('reconcile:item', result);
    } catch (error) {
      summary.failed += 1;
      console.error('reconcile:error', { orderId: order.id, error: error?.message || String(error) });
      if (!dryRun) {
        await recordPaymentEvent(order.id, 'pending', {
          source: 'reconcile-infinitepay-pending-orders',
          dryRun,
          error: error?.message || String(error),
        });
      }
    }
  }

  console.log('reconcile:done', summary);
}

main().catch((error) => {
  console.error('reconcile:fatal', error?.message || error);
  process.exitCode = 1;
});
