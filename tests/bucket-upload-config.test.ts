import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBucketUploadConfig, summarizePayload } from '../scripts/test-bucket-upload.mjs';

describe('bucket upload test config', () => {
  it('accepts the documented bucket value from the provider', () => {
    assert.doesNotThrow(() => assertBucketUploadConfig({
      apiBaseUrl: 'https://99dev.pro/bucket/bucket/api',
      apiToken: 'token',
      bucket: 'slug-do-bucket',
      uploadCount: 5,
    }));
  });

  it('requires bucket credentials before running upload requests', () => {
    assert.throws(
      () => assertBucketUploadConfig({
        apiBaseUrl: '',
        apiToken: '',
        bucket: '',
        uploadCount: 5,
      }),
      /BUCKET_API_BASE_URL, BUCKET_API_TOKEN, MEDIA_BUCKET/,
    );
  });

  it('limits upload test count to a small diagnostic batch', () => {
    assert.throws(
      () => assertBucketUploadConfig({
        apiBaseUrl: 'https://99dev.pro/bucket/bucket/api',
        apiToken: 'token',
        bucket: 'slug-do-bucket',
        uploadCount: 21,
      }),
      /Quantidade invalida/,
    );
  });

  it('summarizes common provider payload shapes without leaking full payloads', () => {
    assert.deepEqual(
      summarizePayload({
        ok: true,
        data: { url: 'https://cdn.example/file.png' },
        message: 'uploaded',
        secret: 'hidden',
      }),
      {
        ok: true,
        id: undefined,
        path: undefined,
        url: 'https://cdn.example/file.png',
        message: 'uploaded',
      },
    );
  });
});
