import type { CreatePaymentInput, PaymentProvider, PaymentStatusResult } from './types.ts';

export const pagarmeProvider: PaymentProvider = {
  name: 'pagarme',

  async createCheckout(_input: CreatePaymentInput) {
    // Estrutura reservada para futura integracao Pagar.me.
    // Implementar aqui chamadas autenticadas com PAGARME_API_KEY, webhooks e mapeamento de status.
    throw new Error('Provider Pagar.me ainda nao esta implementado. Use PAYMENT_PROVIDER=infinitepay.');
  },

  async checkPayment(): Promise<PaymentStatusResult> {
    // Estrutura reservada para futura validacao de webhook/status Pagar.me.
    throw new Error('Provider Pagar.me ainda nao esta implementado.');
  },
};
