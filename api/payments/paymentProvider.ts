import { infinitePayProvider } from './providers/infinitepay';
import { pagarmeProvider } from './providers/pagarme';
import { PaymentProvider } from './providers/types';

export function getActivePaymentProvider(): PaymentProvider {
  const provider = String(process.env.PAYMENT_PROVIDER || 'infinitepay').trim().toLowerCase();

  if (provider === 'infinitepay') return infinitePayProvider;
  if (provider === 'pagarme') return pagarmeProvider;

  throw new Error(`PAYMENT_PROVIDER invalido: ${provider}`);
}
