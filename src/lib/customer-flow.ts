export type PaymentReturnStatus = 'paid' | 'pending' | 'cancelled';

export function buildCustomerOrdersPath(orderId?: string | null, status?: PaymentReturnStatus | null) {
  const params = new URLSearchParams();
  if (orderId) params.set('order', orderId);
  if (status) params.set('status', status);
  const query = params.toString();
  return query ? `/minha-conta?${query}` : '/minha-conta';
}

export function buildLegacyOrdersOpenPath(orderId?: string | null, status?: PaymentReturnStatus | null) {
  const params = new URLSearchParams();
  if (status === 'paid') params.set('payment', 'success');
  if (status === 'cancelled') params.set('payment', 'cancel');
  if (orderId) params.set('order', orderId);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}
