export type PaymentMethod = 'pix' | 'credit_card' | 'checkout';
export type ProviderPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';

export interface PaymentProviderCheckoutItem {
  id: string;
  name: string;
  price: number;
}

export interface PaymentProviderBuyer {
  fullName: string;
  email: string;
  phone?: string;
  cpf?: string;
}

export interface CreatePaymentInput {
  orderId: string;
  buyer: PaymentProviderBuyer;
  items: PaymentProviderCheckoutItem[];
  paymentMethod: PaymentMethod;
  successUrl: string;
  webhookUrl: string;
}

export interface PaymentPixData {
  qrCode?: string;
  qrCodeImage?: string;
  expiresAt?: string;
}

export interface CreatePaymentResult {
  provider: string;
  providerPaymentId?: string | null;
  checkoutUrl?: string | null;
  status: ProviderPaymentStatus;
  method: PaymentMethod;
  pix?: PaymentPixData | null;
  rawResponse: any;
}

export interface PaymentStatusResult {
  status: ProviderPaymentStatus;
  providerPaymentId?: string | null;
  rawResponse: any;
}

export interface PaymentProvider {
  name: string;
  createCheckout(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  checkPayment(input: {
    orderId: string;
    transactionNsu?: string;
    slug?: string;
  }): Promise<PaymentStatusResult>;
}
