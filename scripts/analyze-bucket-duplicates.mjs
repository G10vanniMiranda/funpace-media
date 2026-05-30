import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config({ quiet: true });

const bucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || "https://99dev.pro/bucket/api").replace(/\/+$/, "");
const bucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || "";
const bucket = process.env.MEDIA_BUCKET || process.env.BUCKET || "";
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!bucketToken || !bucket) {
  throw new Error("Variaveis ausentes: BUCKET_API_TOKEN e/ou MEDIA_BUCKET.");
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
  if (!supabaseUrl || !supabaseKey) return [];

  const products = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${supabaseUrl}/rest/v1/products?select=id,name,url,thumbnailUrl,storagePath,status,type,event,vendedorId,createdAt&limit=1000&offset=${offset}`, {
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

function buildReferenceMap(products) {
  const references = new Map();
  for (const product of products) {
    for (const field of ["url", "thumbnailUrl", "storagePath"]) {
      const value = product[field];
      if (!value) continue;
      for (const key of [String(value), String(value).split("/").pop()]) {
        if (!key) continue;
        const current = references.get(key) || [];
        current.push({ productId: product.id, field, status: product.status || "published", event: product.event, type: product.type });
        references.set(key, current);
      }
    }
  }
  return references;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

const files = await listBucketFiles();
const products = await listProducts();
const references = buildReferenceMap(products);

const isReferenced = (file) => Boolean(
  references.has(file.url) || references.has(file.stored_name),
);

const byChecksum = new Map();
for (const file of files) {
  if (!file.checksum_sha256) continue;
  const current = byChecksum.get(file.checksum_sha256) || [];
  current.push(file);
  byChecksum.set(file.checksum_sha256, current);
}

const duplicateGroups = [...byChecksum.values()]
  .filter((group) => group.length > 1)
  .sort((left, right) => right.length - left.length || Number(right[0].size_bytes || 0) - Number(left[0].size_bytes || 0));

const orphanFiles = files.filter((file) => !isReferenced(file));
const duplicateFileIds = new Set(duplicateGroups.flat().map((file) => file.file_id));
const duplicateFiles = files.filter((file) => duplicateFileIds.has(file.file_id));

const report = {
  generatedAt: new Date().toISOString(),
  bucket,
  totals: {
    files: files.length,
    products: products.length,
    activeProducts: products.filter((product) => (product.status || "published") !== "removed").length,
    referencedFiles: files.filter(isReferenced).length,
    orphanFiles: orphanFiles.length,
    duplicateChecksumGroups: duplicateGroups.length,
    duplicateChecksumFiles: duplicateFiles.length,
    potentialReclaimBytesKeepingOnePerChecksum: duplicateGroups.reduce((sum, group) => {
      const sorted = [...group].sort((left, right) => new Date(left.created_at) - new Date(right.created_at));
      return sum + sorted.slice(1).reduce((inner, file) => inner + Number(file.size_bytes || 0), 0);
    }, 0),
  },
  orphanFiles: orphanFiles.map((file) => ({
    file_id: file.file_id,
    file_name: file.file_name,
    size_bytes: file.size_bytes,
    checksum_sha256: file.checksum_sha256,
    created_at: file.created_at,
    url: file.url,
  })),
  duplicateGroups: duplicateGroups.map((group) => ({
    checksum_sha256: group[0].checksum_sha256,
    count: group.length,
    size_bytes: group[0].size_bytes,
    referencedCount: group.filter(isReferenced).length,
    files: group.map((file) => ({
      file_id: file.file_id,
      file_name: file.file_name,
      size_bytes: file.size_bytes,
      created_at: file.created_at,
      url: file.url,
      referenced: isReferenced(file),
      references: [...(references.get(file.url) || []), ...(references.get(file.stored_name) || [])],
    })),
  })),
};

await fs.mkdir("reports", { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const jsonPath = path.join("reports", `bucket-duplicates-${stamp}.json`);
const csvPath = path.join("reports", `bucket-duplicates-${stamp}.csv`);

await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
await fs.writeFile(csvPath, [
  "checksum,file_id,file_name,size_bytes,created_at,referenced,url",
  ...report.duplicateGroups.flatMap((group) => group.files.map((file) => [
    group.checksum_sha256,
    file.file_id,
    JSON.stringify(file.file_name),
    file.size_bytes,
    file.created_at,
    file.referenced,
    file.url,
  ].join(","))),
].join("\n"));

console.log("bucketDuplicateAnalysis:done", {
  jsonPath,
  csvPath,
  files: report.totals.files,
  duplicateGroups: report.totals.duplicateChecksumGroups,
  duplicateFiles: report.totals.duplicateChecksumFiles,
  orphanFiles: report.totals.orphanFiles,
  potentialReclaim: formatBytes(report.totals.potentialReclaimBytesKeepingOnePerChecksum),
});
