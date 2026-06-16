import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateCartPricing } from '../src/lib/cart-pricing';

function photo(id: string, price = 10) {
  return { id, price, type: 'IMG' as const };
}

function video(id: string, price = 20) {
  return { id, price, type: 'VIDEO' as const };
}

test('bulk photo discount is inactive up to four photos', () => {
  const pricing = calculateCartPricing([photo('1'), photo('2'), photo('3'), photo('4')]);

  assert.equal(pricing.photoCount, 4);
  assert.equal(pricing.subtotal, 40);
  assert.equal(pricing.automaticDiscountActive, false);
  assert.equal(pricing.automaticDiscountTotal, 0);
  assert.equal(pricing.total, 40);
});

test('bulk photo discount applies fifteen percent from five photos', () => {
  const pricing = calculateCartPricing([photo('1'), photo('2'), photo('3'), photo('4'), photo('5')]);

  assert.equal(pricing.photoCount, 5);
  assert.equal(pricing.subtotal, 50);
  assert.equal(pricing.automaticDiscountActive, true);
  assert.equal(pricing.automaticDiscountPercent, 15);
  assert.equal(pricing.automaticDiscountTotal, 7.5);
  assert.equal(pricing.total, 42.5);
});

test('bulk photo discount recalculates for six and twenty photos', () => {
  const six = calculateCartPricing(Array.from({ length: 6 }, (_, index) => photo(String(index + 1))));
  const twenty = calculateCartPricing(Array.from({ length: 20 }, (_, index) => photo(String(index + 1))));

  assert.equal(six.automaticDiscountTotal, 9);
  assert.equal(six.total, 51);
  assert.equal(twenty.automaticDiscountTotal, 30);
  assert.equal(twenty.total, 170);
});

test('videos do not count toward the five-photo threshold or photo discount base', () => {
  const fourPhotosOneVideo = calculateCartPricing([photo('1'), photo('2'), photo('3'), photo('4'), video('v1')]);
  const fivePhotosOneVideo = calculateCartPricing([photo('1'), photo('2'), photo('3'), photo('4'), photo('5'), video('v1')]);

  assert.equal(fourPhotosOneVideo.photoCount, 4);
  assert.equal(fourPhotosOneVideo.automaticDiscountTotal, 0);
  assert.equal(fourPhotosOneVideo.total, 60);
  assert.equal(fivePhotosOneVideo.photoCount, 5);
  assert.equal(fivePhotosOneVideo.subtotal, 70);
  assert.equal(fivePhotosOneVideo.automaticDiscountTotal, 7.5);
  assert.equal(fivePhotosOneVideo.total, 62.5);
});

test('removing photos below threshold removes the automatic discount', () => {
  const items = [photo('1'), photo('2'), photo('3'), photo('4'), photo('5')];
  const before = calculateCartPricing(items);
  const after = calculateCartPricing(items.slice(0, 4));

  assert.equal(before.automaticDiscountActive, true);
  assert.equal(after.automaticDiscountActive, false);
  assert.equal(after.total, 40);
});

test('checkout backend applies automatic discount and does not stack with coupons', () => {
  const checkoutApi = readFileSync('api/checkout/create-session.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  assert.match(checkoutApi, /getAutomaticDiscount/);
  assert.match(checkoutApi, /useCouponDiscount/);
  assert.match(checkoutApi, /coupon_nao_acumula_melhor_beneficio/);
  assert.match(checkoutApi, /BULK_PHOTO_DISCOUNT_PERCENT/);
  assert.match(server, /getAutomaticCheckoutDiscount/);
  assert.match(server, /discountTotal/);
});

test('cart and checkout expose transparent discount summary', () => {
  const cart = readFileSync('src/components/CartDrawer.tsx', 'utf8');
  const checkout = readFileSync('src/components/CheckoutPage.tsx', 'utf8');

  assert.match(cart, /calculateCartPricing/);
  assert.match(cart, /Parabens! Voce ganhou 15% de desconto/);
  assert.match(cart, /Voce economizou/);
  assert.match(checkout, /calculateCartPricing/);
  assert.match(checkout, /displayedDiscount/);
  assert.match(checkout, /Voce economizou/);
});
