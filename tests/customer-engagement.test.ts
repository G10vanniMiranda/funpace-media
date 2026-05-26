import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductSharePath } from '../src/lib/customer-engagement';

test('createProductSharePath builds a storefront media deep link', () => {
  assert.equal(createProductSharePath('photo-123'), '/?media=photo-123');
});

test('createProductSharePath encodes unsafe media ids', () => {
  assert.equal(createProductSharePath('media id/with spaces'), '/?media=media%20id%2Fwith%20spaces');
});
