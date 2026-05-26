import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();

const uploadCount = Number(process.argv[2] || 5);
const apiBaseUrl = (process.env.BUCKET_API_BASE_URL || "https://99dev.pro/bucket/bucket/api").replace(/\/+$/, "");
const apiToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || "";
const bucket = process.env.MEDIA_BUCKET || process.env.BUCKET || "";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

export function assertBucketUploadConfig({
  apiBaseUrl,
  apiToken,
  bucket,
  uploadCount,
}) {
  const missing = [];
  if (!apiBaseUrl) missing.push("BUCKET_API_BASE_URL");
  if (!apiToken) missing.push("BUCKET_API_TOKEN");
  if (!bucket) missing.push("MEDIA_BUCKET");

  if (missing.length > 0) {
    throw new Error(`Variaveis ausentes: ${missing.join(", ")}.`);
  }

  if (!Number.isInteger(uploadCount) || uploadCount <= 0 || uploadCount > 20) {
    throw new Error("Quantidade invalida. Use um numero entre 1 e 20.");
  }
}

export function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  return {
    ok: payload.ok,
    id: payload.id,
    path: payload.path || payload.key || payload.filename || payload.name,
    url: payload.url || payload.publicUrl || payload.public_url || payload?.file?.url || payload?.data?.url,
    message: payload.message || payload.msg,
  };
}

function cleanProviderError(raw) {
  const value = String(raw || "");
  const cleaned = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/sess[aã]o expirada/i.test(cleaned)) {
    return "Sessao expirada no provedor de bucket. Atualize a pagina e tente novamente. Se persistir, revise o BUCKET_API_TOKEN.";
  }

  return cleaned || value;
}

async function uploadOne(index) {
  const formData = new FormData();
  const fileName = `funpace-upload-test-${Date.now()}-${index}.png`;

  formData.set("bucket", bucket);
  formData.set("arquivo", new Blob([onePixelPng], { type: "image/png" }), fileName);

  const startedAt = Date.now();
  const response = await fetch(`${apiBaseUrl}/upload`, {
    method: "POST",
    headers: {
      "X-API-Token": apiToken,
    },
    body: formData,
  });

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  const result = {
    index,
    fileName,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    response: summarizePayload(payload),
  };

  if (!response.ok) {
    result.error = cleanProviderError(payload?.error || payload?.message || payload?.raw || raw || `HTTP ${response.status}`);
  }

  return result;
}

async function checkFilesEndpoint() {
  const response = await fetch(`${apiBaseUrl}/files?bucket=${encodeURIComponent(bucket)}`, {
    headers: {
      "X-API-Token": apiToken,
    },
  });
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  return {
    status: response.status,
    ok: response.ok,
    response: summarizePayload(payload),
    raw: response.ok ? undefined : cleanProviderError(raw.slice(0, 500)),
  };
}

async function main() {
  assertBucketUploadConfig({
    apiBaseUrl,
    apiToken,
    bucket,
    uploadCount,
  });

  console.log("bucketUploadTest:start", {
    apiBaseUrl,
    bucket,
    uploadCount,
  });

  const filesCheck = await checkFilesEndpoint();
  console.log("bucketUploadTest:filesCheck", filesCheck);

  const results = [];
  for (let index = 1; index <= uploadCount; index += 1) {
    const result = await uploadOne(index);
    results.push(result);
    console.log("bucketUploadTest:item", result);

    if (!result.ok) {
      throw new Error(`Upload ${index} falhou: ${result.error}`);
    }
  }

  console.log("bucketUploadTest:done", {
    ok: results.every((result) => result.ok),
    uploads: results.length,
    files: results.map((result) => result.fileName),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("bucketUploadTest:failed", {
      message: error?.message || String(error),
    });
    process.exitCode = 1;
  });
}
