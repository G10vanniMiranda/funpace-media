export function buildSafeDownloadPath(orderId: string, orderItemId: string, reason?: 'expired' | 'unavailable') {
  const params = new URLSearchParams({ order: orderId, item: orderItemId });
  if (reason) params.set('reason', reason);
  return `/download?${params.toString()}`;
}

export function shouldUseSafeDownloadPage(environment?: { userAgent?: string; maxTouchPoints?: number }) {
  const browser = environment || (typeof navigator !== 'undefined'
    ? { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }
    : {});
  return Number(browser.maxTouchPoints || 0) > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(browser.userAgent || '');
}
