import dotenv from "dotenv";

dotenv.config({ quiet: true });

const bucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || "https://99dev.pro/bucket/api").replace(/\/+$/, "");
const bucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || "";
const bucket = process.env.MEDIA_BUCKET || process.env.BUCKET || "";
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const dryRun = process.argv.includes("--dry-run");

if (!bucketToken || !bucket || !supabaseUrl || !supabaseKey) {
  throw new Error("Variaveis ausentes: BUCKET_API_TOKEN, MEDIA_BUCKET, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.");
}

async function getBucketPage(page) {
  const response = await fetch(`${bucketApiBaseUrl}/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=100`, {
    headers: { "X-API-Token": bucketToken },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Bucket HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  return payload;
}

async function listBucketFiles() {
  const first = await getBucketPage(1);
  const files = [...(first.files || [])];
  const totalPages = first.pagination?.total_pages || 1;
  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await getBucketPage(page);
    files.push(...(payload.files || []));
  }
  return files.filter((file) => !file.deleted_at && file.status !== "deleted" && file.storage_exists !== false);
}

async function listProducts() {
  const products = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${supabaseUrl}/rest/v1/products?select=id,url,thumbnailUrl,storagePath,fileHash,fileSize,originalFileName,thumbnailHash,status&limit=1000&offset=${offset}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    const batch = await response.json();
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${JSON.stringify(batch).slice(0, 300)}`);
    products.push(...batch);
    if (batch.length < 1000) break;
  }
  return products;
}

async function patchProduct(id, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Patch product ${id} failed: HTTP ${response.status} ${await response.text()}`);
  }
}

function normalizeKey(value) {
  if (!value) return "";
  return String(value).split("/").pop() || String(value);
}

const files = await listBucketFiles();
const filesByKey = new Map();
for (const file of files) {
  for (const key of [file.url, file.stored_name, normalizeKey(file.url)]) {
    if (key) filesByKey.set(String(key), file);
  }
}

const products = await listProducts();
let updated = 0;
let skipped = 0;
let missing = 0;

for (const product of products) {
  const originalFile = filesByKey.get(String(product.url || "")) ||
    filesByKey.get(String(product.storagePath || "")) ||
    filesByKey.get(normalizeKey(product.url || product.storagePath));
  const thumbnailFile = filesByKey.get(String(product.thumbnailUrl || "")) ||
    filesByKey.get(normalizeKey(product.thumbnailUrl));

  const payload = {};
  if (!product.fileHash && originalFile?.checksum_sha256) payload.fileHash = originalFile.checksum_sha256;
  if (!product.fileSize && originalFile?.size_bytes) payload.fileSize = Number(originalFile.size_bytes);
  if (!product.originalFileName && originalFile?.file_name) payload.originalFileName = originalFile.file_name;
  if (!product.thumbnailHash && thumbnailFile?.checksum_sha256) payload.thumbnailHash = thumbnailFile.checksum_sha256;

  if (Object.keys(payload).length === 0) {
    skipped += 1;
    if (!originalFile) missing += 1;
    continue;
  }

  if (!dryRun) await patchProduct(product.id, payload);
  updated += 1;
}

console.log("productFileHashBackfill:done", {
  dryRun,
  products: products.length,
  updated,
  skipped,
  missingOriginalFile: missing,
});
