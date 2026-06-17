import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentStatusResult,
  ProviderPaymentStatus,
} from './types.js';
import {
  getInfinitePayCheckoutEndpoint,
  getInfinitePayPaymentCheckEndpoint,
  fetchWithTimeout,
} from '../../shared/utils.js';

function getHandle() {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) throw new Error('INFINITEPAY_HANDLE não configurado.');
  return handle;
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
  return String(payload?.url || payload?.link || payload?.checkout_url || payload?.payment_url || '');
}

function extractPix(payload: any) {
  const qrCode = String(payload?.pix?.qr_code || payload?.pix_qr_code || payload?.qr_code || payload?.brcode || '').trim();
  const qrCodeImage = String(payload?.pix?.qr_code_image || payload?.pix_qr_code_image || payload?.qr_code_image || '').trim();
  const expiresAt = String(payload?.pix?.expires_at || payload?.pix_expires_at || payload?.expires_at || '').trim();
  if (!qrCode && !qrCodeImage) return null;
  return { qrCode, qrCodeImage, expiresAt };
}

function mapStatusFromPayload(payload: any): ProviderPaymentStatus {
  if (payload?.paid === true) return 'paid';
  const raw = String(payload?.status || payload?.payment_status || payload?.event || payload?.type || '').toLowerCase();
  if (['paid', 'approved', 'confirmed', 'captured', 'received', 'recebido', 'completed', 'settled', 'success', 'succeeded'].includes(raw)) return 'paid';
  if (['rejected', 'denied', 'refused'].includes(raw)) return 'refused';
  if (['failed', 'expired'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(raw)) return 'canceled';
  if (['refunded', 'chargeback'].includes(raw)) return 'refunded';
  return 'pending';
}

export const infinitePayProvider: PaymentProvider = {
  name: 'infinitepay',

  async createCheckout(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const phoneDigits = String(input.buyer.phone || '').replace(/\D/g, '');
    const cpfDigits = String(input.buyer.cpf || '').replace(/\D/g, '').slice(0, 11);
    const payload: any = {
      handle: getHandle(),
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

    payload.customer = {
      name: String(input.buyer.fullName || '').slice(0, 120),
      email: String(input.buyer.email || '').slice(0, 256),
      ...(phoneDigits.length >= 10 ? { phone_number: `+55${phoneDigits}` } : {}),
      document: cpfDigits,
      cpf: cpfDigits,
    };

    console.info('[infinitepay] checkout payload', {
      order_nsu: payload.order_nsu,
      itemCount: payload.items.length,
      hasCustomer: Boolean(payload.customer),
      hasCpf: cpfDigits.length === 11,
      cpfLength: cpfDigits.length,
    });

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
      status: mapStatusFromPayload(data),
      method: input.paymentMethod,
      pix: extractPix(data),
      rawResponse: data,
    };
  },

  async checkPayment(input: { orderId: string; transactionNsu?: string; slug?: string }): Promise<PaymentStatusResult> {
    if (!input.transactionNsu || !input.slug) {
      return { status: 'pending', providerPaymentId: input.transactionNsu || null, rawResponse: { reason: 'missing_transaction_or_slug' } };
    }

    const response = await fetchWithTimeout(getInfinitePayPaymentCheckEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: getHandle(),
        order_nsu: input.orderId,
        transaction_nsu: input.transactionNsu,
        slug: input.slug,
      }),
    }, Number(process.env.INFINITEPAY_REQUEST_TIMEOUT_MS || 7000));
    const raw = await response.text();
    let payload: any = {};

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { message: raw };
    }

    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || raw || `InfinitePay HTTP ${response.status}`);
    }

    return {
      status: mapStatusFromPayload(payload),
      providerPaymentId: input.transactionNsu || null,
      rawResponse: payload,
    };
  },
};
