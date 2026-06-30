import { supabaseRequest } from './utils.js';
import { paidOrderEmailTemplate } from './emailTemplates.js';
import { markReferralFirstSale } from './referrals.js';

type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

export async function recordPayment(input: {
  orderId: string;
  provider: string;
  providerPaymentId?: string | null;
  method?: string | null;
  status: OrderStatus;
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
    console.error('Nao foi possivel registrar payment:', error);
  });

  await supabaseRequest(`/rest/v1/payments?orderId=eq.${encodeURIComponent(input.orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: input.status, updatedAt: new Date().toISOString() }),
  }).catch((error) => {
    console.error('Nao foi possivel atualizar status agregado de payments:', error);
  });
}

export async function releaseDownloadAccess(orderId: string) {
  const orders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,userId,buyerEmail,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];
  if (!order || order.status !== 'paid') return;

  const items = await supabaseRequest<any[]>(
    `/rest/v1/order_items?select=id,orderId,productId&orderId=eq.${encodeURIComponent(orderId)}`,
  );

  if (items.length === 0) return;

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

export async function adjustProductSalesCounts(productIds: unknown[], delta: 1 | -1) {
  const normalizedProductIds = productIds
    .map((productId) => String(productId || '').trim())
    .filter(Boolean);

  if (normalizedProductIds.length === 0) return;

  await supabaseRequest('/rest/v1/rpc/adjust_product_sales_counts', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      product_ids: normalizedProductIds,
      delta,
    }),
  });
}

export async function registerPhotographerTransactions(orderId: string) {
  const settingsRows = await supabaseRequest<any[]>(
    '/rest/v1/platform_settings?select=platformFeePercent&id=eq.default&limit=1',
  ).catch(() => []);
  const feePercent = Number(settingsRows[0]?.platformFeePercent ?? 30);
  const items = await supabaseRequest<any[]>(
    `/rest/v1/order_items?select=id,orderId,productId,vendedorId,price&orderId=eq.${encodeURIComponent(orderId)}`,
  ).catch(() => []);

  if (items.length === 0) return;

  const existingTransactions = await supabaseRequest<any[]>(
    `/rest/v1/photographer_transactions?select=orderItemId&orderId=eq.${encodeURIComponent(orderId)}`,
  ).catch(() => []);
  const processedItemIds = new Set(existingTransactions.map((transaction) => String(transaction.orderItemId || '')));
  const newItems = items.filter((item) => !processedItemIds.has(String(item.id)));
  if (newItems.length === 0) return;

  const transactions = newItems.map((item) => {
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
  });

  await supabaseRequest('/rest/v1/photographer_transactions?on_conflict=orderItemId', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(transactions),
  }).catch((error) => {
    if (!/duplicate|unique/i.test(String(error?.message || error))) {
      console.error('Nao foi possivel registrar transacoes do fotografo:', error);
    }
  });

  await adjustProductSalesCounts(newItems.map((item) => item.productId), 1);

  const saleAmountByPhotographer = new Map<string, number>();
  for (const item of newItems) {
    const photographerId = String(item.vendedorId || '');
    if (!photographerId) continue;
    saleAmountByPhotographer.set(photographerId, (saleAmountByPhotographer.get(photographerId) || 0) + Number(item.price || 0));
  }
  await Promise.all(Array.from(saleAmountByPhotographer.entries()).map(([photographerId, saleAmount]) => (
    markReferralFirstSale(photographerId, saleAmount)
  )));
}

function getFrontendUrl() {
  const value = String(process.env.FRONTEND_URL || '').trim();
  if (!value) throw new Error('FRONTEND_URL ausente.');
  return value.replace(/\/+$/, '');
}

function getNotificationEmail() {
  return process.env.NOTIFICATION_EMAIL || process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL || 'funpacerunclub@gmail.com';
}

async function sendResendEmail(input: { to: string; subject: string; html: string; bcc?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY ausente.');
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM ausente.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      ...(input.bcc ? { bcc: input.bcc } : {}),
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new Error(raw || `Resend HTTP ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

async function recordEmailLog(input: {
  orderId: string;
  customerEmail: string;
  template: string;
  status: 'sent' | 'failed' | 'skipped';
  providerResponse?: any;
  errorMessage?: string | null;
}) {
  await supabaseRequest('/rest/v1/email_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      order_id: input.orderId,
      customer_email: input.customerEmail,
      template: input.template,
      status: input.status,
      provider_response: input.providerResponse ?? null,
      error_message: input.errorMessage ?? null,
    }),
  }).catch((error) => {
    console.error('Nao foi possivel registrar email_logs:', error);
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function resolveOrderEventName(items: any[]) {
  const events = Array.from(new Set(items.map((item) => String(item.event || '').trim()).filter(Boolean)));
  if (events.length === 0) return 'Evento Funpace';
  if (events.length === 1) return events[0];
  return `${events[0]} + ${events.length - 1} evento(s)`;
}

function buildPaidOrderEmail(order: any, items: any[]) {
  const base = getFrontendUrl();
  const ordersUrl = `${base}/minha-conta?order=${encodeURIComponent(order.id)}&status=paid`;
  const downloadsUrl = `${base}/minha-conta?order=${encodeURIComponent(order.id)}&status=paid&download=1`;
  const buyerName = String(order.buyerName || 'cliente').trim();
  const orderShort = String(order.id).slice(0, 8);
  return paidOrderEmailTemplate({
    buyerName,
    orderId: order.id,
    orderShort,
    eventName: resolveOrderEventName(items),
    itemCount: items.length,
    total: formatCurrency(Number(order.total || 0)),
    ordersUrl,
    downloadsUrl,
  });
}

export async function sendPaidOrderEmail(orderId: string, options: { force?: boolean; actor?: 'system' | 'admin' | 'customer' } = {}) {
  const orders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,buyerName,buyerEmail,total,paidEmailSentAt,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];
  if (!order || order.status !== 'paid') return { skipped: true, reason: 'order_not_paid' };

  if (order.paidEmailSentAt && !options.force) {
    await recordEmailLog({
      orderId,
      customerEmail: order.buyerEmail,
      template: 'paid_order_download',
      status: 'skipped',
      errorMessage: 'paidEmailSentAt ja preenchido',
    });
    return { skipped: true, reason: 'already_sent' };
  }

  const items = await supabaseRequest<any[]>(
    `/rest/v1/order_items?select=id,orderId,productId,name,type,price,event&orderId=eq.${encodeURIComponent(orderId)}&order=createdAt.asc`,
  ).catch(() => []);

  try {
    const email = buildPaidOrderEmail(order, items);
    const providerResponse = await sendResendEmail({ to: order.buyerEmail, bcc: getNotificationEmail(), ...email });
    await recordEmailLog({
      orderId,
      customerEmail: order.buyerEmail,
      template: 'paid_order_download',
      status: 'sent',
      providerResponse: { provider: 'resend', response: providerResponse, actor: options.actor || 'system' },
    });
    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ paidEmailSentAt: new Date().toISOString() }),
    });
    return { sent: true, providerResponse };
  } catch (error) {
    await recordEmailLog({
      orderId,
      customerEmail: order.buyerEmail,
      template: 'paid_order_download',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error || 'email_failed'),
    });
    console.error('Nao foi possivel enviar e-mail de pedido pago:', error);
    return { sent: false, error: error instanceof Error ? error.message : String(error || 'email_failed') };
  }
}

export async function sendPaidOrderEmailOnce(orderId: string) {
  return sendPaidOrderEmail(orderId, { force: false, actor: 'system' });
}

export async function fulfillPaidOrder(orderId: string) {
  await releaseDownloadAccess(orderId);
  await registerPhotographerTransactions(orderId);
  await sendPaidOrderEmailOnce(orderId);
}
