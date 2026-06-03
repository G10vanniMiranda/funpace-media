import { infinitePayProvider } from './providers/infinitepay.js';
import { pagarmeProvider } from './providers/pagarme.js';
import type { PaymentProvider } from './providers/types.js';

export function getActivePaymentProvider(): PaymentProvider {
  const provider = String(process.env.PAYMENT_PROVIDER || 'infinitepay').trim().toLowerCase();

  if (provider === 'infinitepay') return infinitePayProvider;
  if (provider === 'pagarme') return pagarmeProvider;

  throw new Error(`PAYMENT_PROVIDER invalido: ${provider}`);
}
