import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerOrdersPath, buildLegacyOrdersOpenPath } from '../src/lib/customer-flow';

test('buildCustomerOrdersPath points paid customers to the unified account page with highlighted order', () => {
  assert.equal(
    buildCustomerOrdersPath('0f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f', 'paid'),
    '/minha-conta?order=0f3f0cc0-8c9b-4ee3-8f25-10e50bc4571f&status=paid',
  );
});

test('buildCustomerOrdersPath supports pending status and no order fallback', () => {
  assert.equal(buildCustomerOrdersPath('order-123', 'pending'), '/minha-conta?order=order-123&status=pending');
  assert.equal(buildCustomerOrdersPath(), '/minha-conta');
});

test('buildLegacyOrdersOpenPath keeps compatibility with the drawer-opening storefront query', () => {
  assert.equal(buildLegacyOrdersOpenPath('order-123', 'paid'), '/?payment=success&order=order-123');
  assert.equal(buildLegacyOrdersOpenPath('order-123', 'cancelled'), '/?payment=cancel&order=order-123');
});
