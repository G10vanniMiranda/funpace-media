import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBypassFaceBackfillRateLimit } from '../server/face/face-rate-limit.js';

function request(input: { method?: string; path?: string; baseUrl?: string; route?: string; token?: string }) {
  return {
    method: input.method || 'POST',
    path: input.path,
    baseUrl: input.baseUrl,
    query: input.route ? { route: input.route } : {},
    headers: input.token ? { authorization: `Bearer ${input.token}` } : {},
  };
}

test('valid OPERATIONS_SECRET bypasses rate limit only for POST face backfill', () => {
  const previous = process.env.OPERATIONS_SECRET;
  process.env.OPERATIONS_SECRET = 'test-operations-secret';
  try {
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      baseUrl: '/api',
      path: '/face/backfill',
      token: 'test-operations-secret',
    })), true);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      route: 'backfill',
      path: '/api/face',
      token: 'test-operations-secret',
    })), true);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      route: 'backfill',
      path: '/api/admin',
      token: 'test-operations-secret',
    })), false);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      baseUrl: '/api',
      path: '/face/search',
      token: 'test-operations-secret',
    })), false);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      method: 'GET',
      path: '/api/face/backfill',
      token: 'test-operations-secret',
    })), false);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      path: '/api/face/backfill',
      token: 'invalid-secret',
    })), false);
    assert.equal(shouldBypassFaceBackfillRateLimit(request({
      path: '/api/face/backfill',
    })), false);
  } finally {
    if (previous === undefined) delete process.env.OPERATIONS_SECRET;
    else process.env.OPERATIONS_SECRET = previous;
  }
});
