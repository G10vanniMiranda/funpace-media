import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || 'sa-east-1';
const bucketName = process.env.AWS_BUCKET_NAME || '';
const timeoutMs = Number(process.env.AWS_REQUEST_TIMEOUT_MS || 20_000);

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region });
  }
  return client;
}

function assertBucket() {
  if (!bucketName) throw new Error('AWS_BUCKET_NAME nao configurado.');
  return bucketName;
}

async function sendWithTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function getAwsBucketName() {
  return assertBucket();
}

export async function testS3Connection() {
  const bucket = assertBucket();
  await sendWithTimeout((abortSignal) => getClient().send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal }));
  return { bucket, region };
}

export async function uploadPrivateImage(input: {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const bucket = assertBucket();
  console.info('[aws-s3] upload:start', { bucket, key: input.key, size: input.buffer.length });
  await sendWithTimeout((abortSignal) => getClient().send(new PutObjectCommand({
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
  const bucket = assertBucket();
  await sendWithTimeout((abortSignal) => getClient().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }), { abortSignal }));
}
