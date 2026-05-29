import { supabaseRequest } from './utils.ts';
import { paidOrderEmailTemplate } from './emailTemplates.ts';

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

  for (const item of newItems) {
    const rows = await supabaseRequest<any[]>(
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

function getFrontendUrl() {
  return String(process.env.FRONTEND_URL || 'https://funpace.media').replace(/\/+$/, '');
}

async function sendResendEmail(input: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'RESEND_API_KEY ausente' };

  const from = process.env.EMAIL_FROM || 'Funpace Media <no-reply@funpace.media>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
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

function buildPaidOrderEmail(order: any) {
  const ordersUrl = `${getFrontendUrl()}/minha-conta?order=${encodeURIComponent(order.id)}&status=paid`;
  const buyerName = String(order.buyerName || 'cliente').trim();
  const orderShort = String(order.id).slice(0, 8);
  return paidOrderEmailTemplate({ buyerName, orderShort, ordersUrl });
}

export async function sendPaidOrderEmailOnce(orderId: string) {
  const orders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=id,buyerName,buyerEmail,paidEmailSentAt,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];
  if (!order || order.status !== 'paid' || order.paidEmailSentAt) return;

  const email = buildPaidOrderEmail(order);
  try {
    await sendResendEmail({ to: order.buyerEmail, ...email });
    await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&paidEmailSentAt=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ paidEmailSentAt: new Date().toISOString() }),
    });
  } catch (error) {
    console.error('Nao foi possivel enviar e-mail de pedido pago:', error);
  }
}

export async function fulfillPaidOrder(orderId: string) {
  await releaseDownloadAccess(orderId);
  await registerPhotographerTransactions(orderId);
  await sendPaidOrderEmailOnce(orderId);
}
