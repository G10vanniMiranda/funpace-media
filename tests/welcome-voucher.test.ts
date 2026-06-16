import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  WELCOME_VOUCHER_CODE,
  WELCOME_VOUCHER_DISMISS_MS,
  WELCOME_VOUCHER_DISMISS_UNTIL_KEY,
  WELCOME_VOUCHER_PENDING_COUPON_KEY,
} from '../src/lib/welcome-voucher';

test('welcome voucher constants define FUNPACE10 and 24h dismissal', () => {
  assert.equal(WELCOME_VOUCHER_CODE, 'FUNPACE10');
  assert.equal(WELCOME_VOUCHER_DISMISS_MS, 24 * 60 * 60 * 1000);
  assert.match(WELCOME_VOUCHER_DISMISS_UNTIL_KEY, /dismiss-until/);
  assert.match(WELCOME_VOUCHER_PENDING_COUPON_KEY, /pending-coupon/);
});

test('welcome voucher modal checks paid orders and offers copy/start shopping actions', () => {
  const modal = readFileSync('src/components/WelcomeVoucherModal.tsx', 'utf8');

  assert.match(modal, /orderService\.getCustomerOrders/);
  assert.match(modal, /status === 'paid'/);
  assert.match(modal, /navigator\.clipboard/);
  assert.match(modal, /Cupom copiado com sucesso!/);
  assert.match(modal, /Comecar a Comprar/);
  assert.match(modal, /popup_viewed/);
  assert.match(modal, /coupon_copied/);
  assert.match(modal, /popup_closed/);
});

test('checkout preloads copied FUNPACE10 and records voucher purchase use', () => {
  const checkout = readFileSync('src/components/CheckoutPage.tsx', 'utf8');

  assert.match(checkout, /WELCOME_VOUCHER_PENDING_COUPON_KEY/);
  assert.match(checkout, /localStorage\.getItem\(WELCOME_VOUCHER_PENDING_COUPON_KEY\)/);
  assert.match(checkout, /result\.couponCode === WELCOME_VOUCHER_CODE/);
  assert.match(checkout, /purchase_used_voucher/);
});

test('backend exposes FUNPACE10 as first-purchase voucher only', () => {
  const checkoutApi = readFileSync('api/checkout/create-session.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  assert.match(checkoutApi, /WELCOME_VOUCHER_CODE = 'FUNPACE10'/);
  assert.match(checkoutApi, /WELCOME_VOUCHER_PERCENT = 10/);
  assert.match(checkoutApi, /hasPaidCustomerOrder/);
  assert.match(checkoutApi, /firstPurchaseEligible/);
  assert.match(server, /WELCOME_VOUCHER_CODE = "FUNPACE10"/);
  assert.match(server, /WELCOME_VOUCHER_PERCENT = 10/);
  assert.match(server, /hasPaidCustomerOrder/);
  assert.match(server, /firstPurchaseEligible/);
});

