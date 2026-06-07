import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

let client: S3Client | null = null;
let clientRegion = '';

export function getAwsS3Config() {
  const bucket = String(process.env.AWS_BUCKET_NAME || '').trim();
  const region = String(process.env.AWS_REGION || '').trim();
  const timeoutMs = Number(process.env.AWS_REQUEST_TIMEOUT_MS || 20_000);

  if (!bucket) throw new Error('AWS_BUCKET_NAME nao configurado.');
  if (!region) throw new Error('AWS_REGION nao configurado.');

  return {
    bucket,
    region,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20_000,
  };
}

function getClient(region: string) {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

async function sendWithTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function getAwsBucketName() {
  return getAwsS3Config().bucket;
}

export async function testS3Connection() {
  const { bucket, region, timeoutMs } = getAwsS3Config();
  await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal }));
  return { bucket, region };
}

export async function uploadPrivateImage(input: {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const { bucket, region, timeoutMs } = getAwsS3Config();
  console.info('[aws-s3] upload:start', { bucket, key: input.key, size: input.buffer.length });
  await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.buffer,
    ContentType: input.contentType,
    Metadata: input.metadata,
    ServerSideEncryption: 'AES256',
  }), { abortSignal }));
  console.info('[aws-s3] upload:done', { bucket, key: input.key });
  return { bucket, key: input.key };
}

export async function deletePrivateObject(key: string) {
  const { bucket, region, timeoutMs } = getAwsS3Config();
  await sendWithTimeout(timeoutMs, (abortSignal) => getClient(region).send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }), { abortSignal }));
}
