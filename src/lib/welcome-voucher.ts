export const WELCOME_VOUCHER_CODE = 'FUNPACE10';
export const WELCOME_VOUCHER_DISMISS_UNTIL_KEY = 'funpace:welcome-voucher:dismiss-until:v1';
export const WELCOME_VOUCHER_PENDING_COUPON_KEY = 'funpace:welcome-voucher:pending-coupon:v1';
export const WELCOME_VOUCHER_EVENTS_KEY = 'funpace:welcome-voucher:events:v1';
export const WELCOME_VOUCHER_DISMISS_MS = 24 * 60 * 60 * 1000;

export type WelcomeVoucherEventName = 'popup_viewed' | 'coupon_copied' | 'popup_closed' | 'purchase_used_voucher';

export function recordWelcomeVoucherEvent(name: WelcomeVoucherEventName, metadata: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;

  const event = {
    name,
    metadata,
    createdAt: new Date().toISOString(),
  };

  try {
    const raw = window.localStorage.getItem(WELCOME_VOUCHER_EVENTS_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(current) ? [event, ...current].slice(0, 100) : [event];
    window.localStorage.setItem(WELCOME_VOUCHER_EVENTS_KEY, JSON.stringify(next));
  } catch {
    // Analytics local is best-effort and must not block checkout.
  }

  console.info('[welcome-voucher]', event);
}

export function hasActiveWelcomeVoucherDismissal(now = Date.now()) {
  if (typeof window === 'undefined') return true;

  try {
    const dismissUntil = Number(window.localStorage.getItem(WELCOME_VOUCHER_DISMISS_UNTIL_KEY) || 0);
    return Number.isFinite(dismissUntil) && dismissUntil > now;
  } catch {
    return true;
  }
}

export function dismissWelcomeVoucher(now = Date.now()) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(WELCOME_VOUCHER_DISMISS_UNTIL_KEY, String(now + WELCOME_VOUCHER_DISMISS_MS));
  } catch {
    // Ignore storage failures.
  }
}

export function saveWelcomeVoucherForCheckout() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(WELCOME_VOUCHER_PENDING_COUPON_KEY, WELCOME_VOUCHER_CODE);
  } catch {
    // Ignore storage failures.
  }
}

