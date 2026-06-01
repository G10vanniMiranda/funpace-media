import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1] || path.join('backups', stamp);
const downloadFiles = process.argv.includes('--download-files');
const perPage = Math.min(Math.max(Number(process.argv.find((arg) => arg.startsWith('--per-page='))?.split('=')[1] || 100), 10), 500);

function requireEnv(name, fallbackNames = []) {
  const value = [name, ...fallbackNames].map((key) => process.env[key]).find((item) => String(item || '').trim());
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return String(value).trim();
}

const bucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
const bucketToken = requireEnv('BUCKET_API_TOKEN', ['BUCKET_X_API_TOKEN']);
const bucket = requireEnv('MEDIA_BUCKET', ['BUCKET']);
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

async function bucketRequest(pathname) {
  const response = await fetch(`${bucketApiBaseUrl}${pathname}`, {
    headers: { 'X-API-Token': bucketToken },
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || raw || `Bucket HTTP ${response.status}`);
  }
  return payload;
}

async function listBucketFiles() {
  const first = await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=1&per_page=${perPage}`);
  const files = [...(first.files || [])];
  const totalPages = first.pagination?.total_pages || 1;
  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await bucketRequest(`/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=${perPage}`);
    files.push(...(payload.files || []));
  }
  return files.filter((file) => !file.deleted_at && file.status !== 'deleted' && file.storage_exists !== false);
}

async function supabaseRequest(pathname) {
  if (!supabaseUrl || !supabaseKey) return [];
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data?.message || raw || `Supabase HTTP ${response.status}`);
  }
  return data;
}

async function listProducts() {
  if (!supabaseUrl || !supabaseKey) return [];
  const products = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: 'id,name,type,status,event,checkpoint,bib,vendedorId,url,thumbnailUrl,storagePath,fileHash,thumbnailHash,fileSize,originalFileName,createdAt',
      limit: '1000',
      offset: String(offset),
    });
    const batch = await supabaseRequest(`/rest/v1/products?${query.toString()}`);
    products.push(...batch);
    if (batch.length < 1000) break;
  }
  return products;
}

function normalizeKey(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(new URL(String(value)).pathname.split('/').pop() || '');
  } catch {
    return String(value).split('/').pop() || String(value);
  }
}

function buildProductReferences(products) {
  const references = new Map();
  for (const product of products) {
    for (const field of ['url', 'thumbnailUrl', 'storagePath']) {
      const value = product[field];
      if (!value) continue;
      for (const key of [String(value), normalizeKey(value)]) {
        if (!key) continue;
        const current = references.get(key) || [];
        current.push({
          productId: product.id,
          field,
          status: product.status,
          type: product.type,
          event: product.event,
          bib: product.bib,
        });
        references.set(key, current);
      }
    }
  }
  return references;
}

function safeFileName(file) {
  const source = file.stored_name || file.file_name || file.file_id || 'bucket-file';
  return String(source).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 180);
}

async function downloadFile(file, targetDir) {
  if (!file.url) return { skipped: true, reason: 'missing_url' };
  const response = await fetch(file.url);
  if (!response.ok) return { skipped: true, reason: `HTTP ${response.status}` };
  const arrayBuffer = await response.arrayBuffer();
  const filePath = path.join(targetDir, safeFileName(file));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  return { file: path.relative(outputRoot, filePath).replace(/\\/g, '/'), bytes: arrayBuffer.byteLength };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  console.log('backupBucket:start', { outputRoot, bucket, downloadFiles });
  const [files, products] = await Promise.all([listBucketFiles(), listProducts()]);
  const references = buildProductReferences(products);
  const filesDir = path.join(outputRoot, 'bucket-files');

  const manifestFiles = [];
  let downloaded = 0;
  let downloadWarnings = 0;

  for (const file of files) {
    const refs = [
      ...(references.get(file.url) || []),
      ...(references.get(file.stored_name) || []),
      ...(references.get(normalizeKey(file.url)) || []),
    ];
    const record = {
      file_id: file.file_id,
      file_name: file.file_name,
      stored_name: file.stored_name,
      url: file.url,
      size_bytes: Number(file.size_bytes || 0),
      checksum_sha256: file.checksum_sha256 || null,
      mime_type: file.mime_type || file.content_type || null,
      created_at: file.created_at,
      updated_at: file.updated_at,
      references: refs,
    };

    if (downloadFiles) {
      const result = await downloadFile(file, filesDir);
      record.local_backup = result;
      if (result.file) downloaded += 1;
      if (result.skipped) downloadWarnings += 1;
    }

    manifestFiles.push(record);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    type: downloadFiles ? 'bucket-manifest-and-files' : 'bucket-manifest',
    bucketApiBaseUrl,
    bucket,
    outputRoot,
    totals: {
      files: files.length,
      products: products.length,
      referencedFiles: manifestFiles.filter((file) => file.references.length > 0).length,
      unreferencedFiles: manifestFiles.filter((file) => file.references.length === 0).length,
      downloaded,
      downloadWarnings,
      totalBytes: manifestFiles.reduce((sum, file) => sum + Number(file.size_bytes || 0), 0),
    },
    files: manifestFiles,
  };

  await writeJson(path.join(outputRoot, 'bucket-manifest.json'), manifest);
  console.log('backupBucket:done', manifest.totals);
}

main().catch((error) => {
  console.error('backupBucket:failed', { message: error?.message || String(error) });
  process.exitCode = 1;
});
