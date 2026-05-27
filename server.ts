import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import pg from "pg";
import cors from "cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidCpf, onlyCpfDigits } from "./src/lib/cpf";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const { Pool } = pg;

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

function getAllowedOrigins() {
  return new Set([
    "https://funpace.media",
    "https://www.funpace.media",
    "http://localhost:3000",
    "http://localhost:5173",
    process.env.FRONTEND_URL,
    process.env.VITE_FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || "").split(","),
  ].filter((origin): origin is string => Boolean(origin)).map((origin) => origin.replace(/\/+$/, "")));
}

const allowedOrigins = getAllowedOrigins();

app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = origin?.replace(/\/+$/, "");

    if (!normalizedOrigin || allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origem nao permitida pelo CORS."));
  },
}));

app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));

function getDbConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
  const dbPassword = process.env.DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.POSTGRES;

  if (!process.env.DATABASE_URL && typeof dbPassword !== "string") {
    throw new Error("Senha do Postgres nao configurada. Defina DB_PASSWORD, POSTGRES_PASSWORD, PGPASSWORD ou DATABASE_URL no .env.");
  }

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || process.env.PGHOST || process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DATABASE || process.env.PGDATABASE || "postgres",
        user: process.env.DB_USER || process.env.PGUSER || process.env.POSTGRES_USER || "postgres",
        password: dbPassword,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };
}

const mediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER || "supabase";
const mediaBucket = process.env.MEDIA_BUCKET || process.env.BUCKET || "";
const externalBucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || "https://99dev.pro/bucket/api").replace(/\/+$/, "");
const externalBucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || "";

function usesExternalBucket() {
  return mediaStorageProvider === "external_bucket" || Boolean(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN);
}

function legacyInfinitePayEnabled() {
  return process.env.ENABLE_LEGACY_INFINITEPAY_ENDPOINTS === "true" &&
    process.env.ALLOW_INSECURE_LEGACY_INFINITEPAY_ENDPOINTS === "true";
}

function getSupabaseApiConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase API nao configurada. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env do servidor.");
  }

  return { supabaseUrl, supabaseKey };
}

let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
    supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseAdmin;
}

function getExternalBucketConfig() {
  if (!externalBucketToken) {
    throw new Error("BUCKET_API_TOKEN nao configurado no servidor.");
  }

  if (!mediaBucket) {
    throw new Error("MEDIA_BUCKET nao configurado no servidor.");
  }

  return {
    baseUrl: externalBucketApiBaseUrl,
    token: externalBucketToken,
    bucket: mediaBucket,
  };
}

function assertMediaBucketConfigured() {
  if (!mediaBucket) {
    throw new Error("MEDIA_BUCKET nao configurado no servidor.");
  }
}

function getBearerToken(req: express.Request) {
  const header = req.header("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function getAuthenticatedRequestUser(req: express.Request): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

async function getAuthenticatedAdminUser(req: express.Request): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.id) return null;

  const role = String(data.user.app_metadata?.role || "");
  if (role !== "admin") return null;

  return {
    id: data.user.id,
    email: data.user.email ? data.user.email.toLowerCase() : null,
  };
}

function getPhotographerPasswordSetupUrl(req: express.Request) {
  const configuredFrontend = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || "";
  const origin = configuredFrontend || `${req.protocol}://${req.get("host")}`;
  return `${origin.replace(/\/+$/, "")}/fotografo/definir-senha`;
}

async function createSignedMediaUrl(rawPathOrUrl: string, _expiresIn = 900) {
  return createPublicMediaUrl(rawPathOrUrl);
}

function createPublicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;

  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || "";
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, "")}/${encodeURI(rawPathOrUrl.replace(/^\/+/, ""))}`;
  }

  return rawPathOrUrl;
}

function decodeHeaderValue(value: string | undefined) {
  if (!value) return "";

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pickUploadedMediaUrl(payload: any) {
  const candidates = [
    payload?.url,
    payload?.publicUrl,
    payload?.public_url,
    payload?.downloadUrl,
    payload?.download_url,
    payload?.file?.url,
    payload?.file?.publicUrl,
    payload?.arquivo?.url,
    payload?.data?.url,
    payload?.data?.publicUrl,
  ];

  return candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
}

function cleanProviderErrorMessage(raw: string, fallback: string) {
  const withoutTags = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();

  if (/sess[aã]o expirada/i.test(decoded)) {
    return "Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.";
  }

  return decoded || fallback;
}

async function uploadToExternalBucket(path: string, fileName: string, contentType: string, buffer: Buffer) {
  const { baseUrl, token, bucket } = getExternalBucketConfig();
  const formData = new FormData();
  const safeFileName = path.split("/").pop() || fileName || "arquivo";

  formData.set("bucket", bucket);
  formData.set("arquivo", new Blob([buffer], { type: contentType || "application/octet-stream" }), safeFileName);

  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: {
      "X-API-Token": token,
    },
    body: formData,
  });

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const providerMessage = payload?.error || payload?.message || payload?.raw || raw;
    throw new Error(cleanProviderErrorMessage(String(providerMessage || ""), `Upload externo falhou com status ${response.status}.`));
  }

  const publicUrl = pickUploadedMediaUrl(payload);
  return {
    path: publicUrl || payload?.path || payload?.key || path,
    publicUrl,
    providerPayload: payload,
  };
}

function getStorageQuotaBytes() {
  return Number(process.env.BUCKET_STORAGE_QUOTA_BYTES || 250 * 1024 * 1024 * 1024);
}

async function getExternalBucketStorageStats() {
  const { baseUrl, token, bucket } = getExternalBucketConfig();
  const response = await fetch(`${baseUrl}/files?bucket=${encodeURIComponent(bucket)}`, {
    headers: {
      "X-API-Token": token,
    },
  });
  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const providerMessage = payload?.error || payload?.message || payload?.raw || raw;
    throw new Error(cleanProviderErrorMessage(String(providerMessage || ""), `Consulta do bucket falhou com status ${response.status}.`));
  }

  const files = Array.isArray(payload?.files) ? payload.files : [];
  const activeFiles = files.filter((file: any) => !file?.deleted_at && file?.status !== "deleted" && file?.storage_exists !== false);
  const usedBytes = activeFiles.reduce((sum: number, file: any) => sum + Number(file?.size_bytes || file?.size || 0), 0);
  const quotaBytes = getStorageQuotaBytes();
  const byType = activeFiles.reduce((acc: Record<string, { count: number; bytes: number }>, file: any) => {
    const key = String(file?.file_type || file?.mime_type || file?.extension || "outros").toLowerCase();
    const current = acc[key] ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += Number(file?.size_bytes || file?.size || 0);
    acc[key] = current;
    return acc;
  }, {});

  return {
    bucket,
    usedBytes,
    quotaBytes,
    usagePercent: quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0,
    totalFiles: activeFiles.length,
    byType,
    updatedAt: new Date().toISOString(),
  };
}

function isUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getWebhookSecret() {
  return process.env.INFINITEPAY_WEBHOOK_SECRET || process.env.INFINITEPAY_WEBHOOK_TOKEN || "";
}

function getWebhookSignature(req: express.Request) {
  return req.header("x-infinitepay-signature") ||
    req.header("x-webhook-signature") ||
    req.header("x-signature") ||
    "";
}

function parseSignatureHeader(signatureHeader: string) {
  const result = {
    timestamp: "",
    signatures: [] as string[],
  };

  for (const part of signatureHeader.split(",")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join("=").trim();

    if (!value) continue;
    if (key === "t" || key === "timestamp") {
      result.timestamp = value;
    } else if (key === "sha256" || key === "v1" || key === "signature") {
      result.signatures.push(value);
    }
  }

  if (result.signatures.length === 0 && signatureHeader.trim()) {
    result.signatures.push(signatureHeader.trim().replace(/^sha256=/i, ""));
  }

  return result;
}

function hmacSha256(secret: string, payload: string | Buffer) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqualHex(left: string, right: string) {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();

  if (!/^[0-9a-f]+$/i.test(normalizedLeft) || !/^[0-9a-f]+$/i.test(normalizedRight)) {
    return false;
  }

  const leftBuffer = Buffer.from(normalizedLeft, "hex");
  const rightBuffer = Buffer.from(normalizedRight, "hex");

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidWebhookSignature(req: express.Request) {
  const secret = getWebhookSecret();
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const signatureHeader = getWebhookSignature(req);

  if (!secret || !rawBody || !signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  const candidates = [hmacSha256(secret, rawBody)];

  if (parsed.timestamp) {
    candidates.push(hmacSha256(secret, `${parsed.timestamp}.${rawBody.toString("utf8")}`));
  }

  return parsed.signatures.some((signature) =>
    candidates.some((candidate) => timingSafeEqualHex(signature, candidate)),
  );
}

function getWebhookOrderId(payload: any) {
  return payload?.order_nsu ||
    payload?.order ||
    payload?.orderId ||
    payload?.reference ||
    payload?.external_reference ||
    payload?.metadata?.orderId ||
    "";
}

function getWebhookEventId(payload: any, orderId: string, status: string) {
  return String(
    payload?.id ||
    payload?.event_id ||
      payload?.eventId ||
      payload?.transaction_nsu ||
      payload?.transaction_id ||
      payload?.transactionId ||
      payload?.invoice_slug ||
      `${orderId || "unknown"}:${status || "unknown"}`,
  );
}

function mapNonPaidPaymentStatus(status: unknown) {
  const normalized = String(status || "").toLowerCase();
  if (["failed", "rejected", "denied", "expired"].includes(normalized)) return "failed";
  if (["cancelled", "canceled", "voided"].includes(normalized)) return "cancelled";
  if (["refunded", "chargeback"].includes(normalized)) return "refunded";
  return "pending";
}

function getRequestOrigin(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function getInfinitePayBaseUrl() {
  return (process.env.INFINITEPAY_BASE_URL || "https://api.checkout.infinitepay.io").replace(/\/+$/, "");
}

function getInfinitePayWebhookUrl(req: express.Request) {
  return `${getRequestOrigin(req)}/api/webhooks/infinitepay`;
}

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "https://funpace.media").replace(/\/+$/, "");
}

function getApiUrl() {
  return (process.env.API_URL || "https://api.funpace.media").replace(/\/+$/, "");
}

function getInfinitePayCheckoutEndpoint() {
  return process.env.INFINITEPAY_CHECKOUT_ENDPOINT || "https://api.checkout.infinitepay.io/links";
}

function getAllowedRedirectOrigins(req: express.Request) {
  return new Set([
    getRequestOrigin(req),
    "https://funpace.media",
    "https://www.funpace.media",
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || "").split(","),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, "")));
}

function buildSafeCheckoutSuccessUrl(req: express.Request, inputUrl: string | undefined, orderId: string) {
  const fallback = `${getRequestOrigin(req)}/pagamento/sucesso`;
  const candidate = new URL(inputUrl || fallback, fallback);
  const origin = candidate.origin.replace(/\/+$/, "");

  if (!getAllowedRedirectOrigins(req).has(origin)) {
    throw new Error("URL de retorno do checkout nao autorizada.");
  }

  candidate.searchParams.set("payment", "success");
  candidate.searchParams.set("order", orderId);
  return candidate.toString();
}

function assertInfinitePayCheckoutUrl(value: string) {
  const parsed = new URL(value);
  const allowedHosts = (process.env.INFINITEPAY_CHECKOUT_ALLOWED_HOSTS || "infinitepay.io,checkout.infinitepay.io,api.checkout.infinitepay.io")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const hostname = parsed.hostname.toLowerCase();
  const allowed = parsed.protocol === "https:" && allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

  if (!allowed) {
    throw new Error("InfinitePay retornou uma URL de checkout fora dos dominios permitidos.");
  }
}

function getInfinitePayPaymentCheckEndpoint() {
  return process.env.INFINITEPAY_PAYMENT_CHECK_ENDPOINT || `${getInfinitePayBaseUrl()}/payment_check`;
}

async function checkInfinitePayPayment(input: {
  handle: string;
  orderId: string;
  transactionNsu: string;
  slug: string;
}) {
  const paymentCheckResponse = await fetch(getInfinitePayPaymentCheckEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: input.handle,
      order_nsu: input.orderId,
      transaction_nsu: input.transactionNsu,
      slug: input.slug,
    }),
  });

  if (!paymentCheckResponse.ok) {
    const message = await paymentCheckResponse.text();
    throw new Error(message || "Falha ao confirmar pagamento na InfinitePay.");
  }

  return paymentCheckResponse.json().catch(() => ({}));
}

function isValidCheckoutItem(item: any) {
  return typeof item?.description === "string" &&
    item.description.trim().length > 0 &&
    Number.isInteger(item?.quantity) &&
    item.quantity > 0 &&
    Number.isInteger(item?.price) &&
    item.price > 0;
}

function normalizeCheckoutItems(items: any[]) {
  return items.map((item) => ({
    description: String(item.description).trim().slice(0, 180),
    quantity: item.quantity,
    price: item.price,
  }));
}

function isMissingColumnError(error: any) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "PGRST204" ||
    error?.code === "42703" ||
    message.toLowerCase().includes("could not find") ||
    message.toLowerCase().includes("column");
}

async function updateOrderWithFallback(orderId: string, primaryPayload: Record<string, any>, legacyPayload: Record<string, any>) {
  const supabase = getSupabaseAdmin();
  const primary = await supabase
    .from("orders")
    .update(primaryPayload)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();

  if (!primary.error) {
    if (!primary.data) throw new Error("Pedido nao encontrado no Supabase.");
    return;
  }

  if (!isMissingColumnError(primary.error)) {
    throw primary.error;
  }

  const legacy = await supabase
    .from("orders")
    .update(legacyPayload)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();

  if (legacy.error) throw legacy.error;
  if (!legacy.data) throw new Error("Pedido nao encontrado no Supabase.");
}

app.get("/health", (_req, res) => {
  res.json({ status: "online", api: "Funpace API" });
});

app.post("/payments/infinitepay/create", async (req, res) => {
  if (!legacyInfinitePayEnabled()) {
    return res.status(410).json({
      success: false,
      error: "Endpoint legado inseguro desativado. Use /api/checkout/create-session.",
    });
  }

  try {
    const orderId = String(req.body?.orderId || "").trim();
    const items = req.body?.items;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "orderId e obrigatorio.",
      });
    }

    if (!Array.isArray(items) || items.length === 0 || !items.every(isValidCheckoutItem)) {
      return res.status(400).json({
        success: false,
        error: "items deve conter ao menos um item com description, quantity e price em centavos.",
      });
    }

    const handle = process.env.INFINITEPAY_HANDLE;
    if (!handle) {
      return res.status(500).json({
        success: false,
        error: "INFINITEPAY_HANDLE nao configurado no servidor.",
      });
    }

    const redirectUrl = `${getFrontendUrl()}/pagamento/sucesso?order_id=${encodeURIComponent(orderId)}`;
    const webhookUrl = `${getApiUrl()}/payments/infinitepay/webhook`;
    const checkoutPayload = {
      handle,
      redirect_url: redirectUrl,
      webhook_url: webhookUrl,
      order_nsu: orderId,
      items: normalizeCheckoutItems(items),
    };

    const checkoutResponse = await fetch(getInfinitePayCheckoutEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload),
    });

    const checkoutRaw = await checkoutResponse.text();
    let checkoutData: any = {};
    try {
      checkoutData = checkoutRaw ? JSON.parse(checkoutRaw) : {};
    } catch {
      checkoutData = { message: checkoutRaw };
    }

    if (!checkoutResponse.ok) {
      console.error("Erro InfinitePay create link:", checkoutResponse.status, checkoutData);
      return res.status(502).json({
        success: false,
        error: checkoutData?.message || checkoutData?.error || "Falha ao criar link na InfinitePay.",
      });
    }

    const paymentUrl = checkoutData?.url;
    if (typeof paymentUrl !== "string" || !paymentUrl.startsWith("http")) {
      console.error("Resposta invalida da InfinitePay:", checkoutData);
      return res.status(502).json({
        success: false,
        error: "InfinitePay nao retornou uma URL de pagamento valida.",
      });
    }

    const now = new Date().toISOString();
    await updateOrderWithFallback(
      orderId,
      {
        status: "pending",
        payment_provider: "infinitepay",
        payment_url: paymentUrl,
        updated_at: now,
      },
      {
        status: "pending",
        paymentProvider: "infinitepay",
        checkoutUrl: paymentUrl,
        updatedAt: now,
      },
    );

    return res.json({
      success: true,
      paymentUrl,
    });
  } catch (error: any) {
    console.error("Erro ao criar pagamento InfinitePay:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro interno ao criar pagamento.",
    });
  }
});

app.post("/payments/infinitepay/webhook", async (req, res) => {
  if (!legacyInfinitePayEnabled()) {
    return res.status(410).json({
      received: false,
      error: "Webhook legado inseguro desativado. Use /api/webhooks/infinitepay.",
    });
  }

  const payload = req.body ?? {};
  const orderId = String(payload?.order_nsu || "").trim();

  try {
    if (!orderId) {
      return res.status(400).json({
        received: false,
        error: "order_nsu ausente no webhook.",
      });
    }

    const now = new Date().toISOString();
    await updateOrderWithFallback(
      orderId,
      {
        status: "paid",
        payment_provider: "infinitepay",
        payment_id: payload?.transaction_nsu ?? null,
        receipt_url: payload?.receipt_url ?? null,
        paid_amount: payload?.paid_amount ?? null,
        payment_method: payload?.capture_method ?? null,
        webhook_payload: payload,
        paid_at: now,
        updated_at: now,
      },
      {
        status: "paid",
        paymentProvider: "infinitepay",
        paymentExternalId: payload?.transaction_nsu ?? null,
        updatedAt: now,
      },
    );

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error("Erro no webhook InfinitePay:", error, { orderId, payload });
    return res.status(500).json({
      received: false,
      error: error?.message || "Erro interno ao processar webhook.",
    });
  }
});

app.get("/api/health", async (req, res) => {
  const dbConfig = getDbConfig();
  const status: any = {
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SUPABASE_URL: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      INFINITEPAY_HANDLE: !!process.env.INFINITEPAY_HANDLE,
      INFINITEPAY_WEBHOOK_SECRET: !!getWebhookSecret(),
    },
    database: "unchecked",
  };

  if ((dbConfig as any).host || (dbConfig as any).connectionString) {
    const pool = new Pool(dbConfig);
    try {
      const result = await pool.query("select now()");
      status.database = "connected";
      status.serverTime = result.rows[0].now;
    } catch (err: any) {
      status.database = "failed: " + err.message;
    } finally {
      await pool.end();
    }
  }

  res.json(status);
});

app.get("/api/auth/google/status", async (req, res) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";

  if (!supabaseUrl) {
    return res.status(500).json({
      enabled: false,
      error: "Supabase nao configurado.",
    });
  }

  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", origin);
    authorizeUrl.searchParams.set("response_type", "token");

    const response = await fetch(authorizeUrl.toString(), {
      method: "GET",
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const googleLocation = response.headers.get("location") || "";
      const googleRedirectUri = googleLocation
        ? new URL(googleLocation).searchParams.get("redirect_uri")
        : `${supabaseUrl}/auth/v1/callback`;

      if (googleLocation) {
        const googleResponse = await fetch(googleLocation, {
          method: "GET",
          redirect: "manual",
        });
        const googleBody = await googleResponse.text();

        if (
          googleResponse.status >= 400 &&
          googleBody.toLowerCase().includes("redirect_uri_mismatch")
        ) {
          return res.status(400).json({
            enabled: false,
            error: `Google OAuth nao aceita a URL de callback. Cadastre esta URL no Google Cloud: ${googleRedirectUri}`,
            redirectUri: googleRedirectUri,
          });
        }
      }

      return res.json({
        enabled: true,
        redirectUri: googleRedirectUri,
      });
    }

    const raw = await response.text();
    let message = "Login com Google nao esta habilitado no Supabase.";

    try {
      const parsed = JSON.parse(raw);
      message = parsed?.msg || parsed?.message || parsed?.error_description || message;
    } catch {
      if (raw) message = raw;
    }

    return res.status(400).json({
      enabled: false,
      error: message,
    });
  } catch (error: any) {
    return res.status(502).json({
      enabled: false,
      error: error?.message || "Nao foi possivel validar o Google no Supabase.",
    });
  }
});

app.post("/api/admin/photographers/invite", async (req, res) => {
  let pool: pg.Pool | null = null;

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) {
      return res.status(403).json({ error: "Apenas administradores podem convidar fotografos." });
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const bio = typeof req.body?.bio === "string" ? req.body.bio.trim().slice(0, 1000) : "";

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Nome do fotografo invalido." });
    }

    if (!email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email do fotografo invalido." });
    }

    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    const pendingId = `pending:${email}`;

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    await pool.query(
      `
        insert into public.photographers (
          id,
          name,
          email,
          bio,
          avatar,
          verified,
          stats,
          "createdAt",
          "updatedAt"
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          false,
          jsonb_build_object(
            'photos', 0,
            'events', 0,
            'rating', 5,
            'totalEarnings', 0,
            'pendingEarnings', 0,
            'salesCount', 0
          ),
          now(),
          now()
        )
        on conflict (email) do update set
          name = excluded.name,
          bio = excluded.bio,
          avatar = coalesce(nullif(public.photographers.avatar, ''), excluded.avatar),
          stats = coalesce(public.photographers.stats, excluded.stats),
          "updatedAt" = now()
      `,
      [pendingId, name, email, bio, avatar],
    );

    const redirectTo = getPhotographerPasswordSetupUrl(req);
    const supabase = getSupabaseAdmin();
    let delivery: "invite" | "password_reset" = "invite";

    const inviteResult = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        name,
        role: "photographer",
      },
      redirectTo,
    });

    if (inviteResult.error) {
      const inviteMessage = String(inviteResult.error.message || "").toLowerCase();
      const userAlreadyExists = inviteMessage.includes("already") ||
        inviteMessage.includes("registered") ||
        inviteMessage.includes("exists");

      if (!userAlreadyExists) {
        throw inviteResult.error;
      }

      const resetResult = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetResult.error) throw resetResult.error;
      delivery = "password_reset";
    }

    await pool.query("commit");
    return res.json({
      ok: true,
      delivery,
      redirectTo,
      message: delivery === "invite"
        ? "Fotografo cadastrado e convite de senha enviado por email."
        : "Fotografo atualizado e email de redefinicao de senha enviado.",
    });
  } catch (error: any) {
    if (pool) {
      try {
        await pool.query("rollback");
      } catch {
        // ignore rollback errors
      }
    }

    console.error("Erro ao convidar fotografo:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel convidar o fotografo." });
  } finally {
    if (pool) await pool.end();
  }
});

app.post("/api/checkout/create-session", async (req, res) => {
  let orderId = "";

  try {
    const { items, successUrl, buyer } = req.body;
    const authUser = await getAuthenticatedRequestUser(req);

    if (!authUser?.id) {
      return res.status(401).json({ error: "Entre novamente para iniciar o pagamento." });
    }

    if (!buyer?.cpf || !isValidCpf(buyer.cpf)) {
      return res.status(400).json({ error: "CPF valido e obrigatorio para pagamento." });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: "Dados do comprador incompletos." });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio." });
    }

    const productIds = [...new Set(items.map((item: any) => String(item.id || "").trim()))];
    if (productIds.length !== items.length || !productIds.every(isUuid)) {
      return res.status(400).json({ error: "Carrinho contem produto invalido." });
    }

    const { data: products, error: productsError } = await getSupabaseAdmin()
      .from("products")
      .select("id,name,price,url,type,vendedorId,bib,event,checkpoint,thumbnailUrl")
      .in("id", productIds)
      .eq("status", "published");

    if (productsError) throw productsError;

    if (!products || products.length !== productIds.length) {
      return res.status(400).json({ error: "Um ou mais produtos nao estao disponiveis." });
    }

    const total = products.reduce((sum: number, product: any) => sum + Number(product.price), 0);
    const buyerCpf = onlyCpfDigits(buyer.cpf);
    const inputBuyerEmail = String(buyer.email).trim().toLowerCase();
    if (authUser.email && inputBuyerEmail && inputBuyerEmail !== authUser.email) {
      return res.status(403).json({ error: "Use o mesmo e-mail da conta logada para finalizar a compra." });
    }

    const buyerEmail = authUser.email || inputBuyerEmail;
    const buyerName = String(buyer.fullName).trim();
    const buyerPhone = String((buyer as any).phone || "nao_informado").trim();

    if (total <= 1) {
      return res.status(400).json({
        error: "A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.",
      });
    }

    const { error: customerError } = await getSupabaseAdmin()
      .from("customers")
      .upsert({
        id: authUser.id,
        email: buyerEmail,
        name: buyerName,
        phone: buyerPhone,
        cpf: buyerCpf,
      }, { onConflict: "id" });

    if (customerError) throw customerError;

    const { data: order, error: orderError } = await getSupabaseAdmin()
      .from("orders")
      .insert({
        userId: authUser.id,
        buyerName,
        buyerEmail,
        buyerPhone,
        buyerCpf,
        total,
        status: "pending",
        paymentProvider: "infinitepay",
      })
      .select("id")
      .single();

    if (orderError) throw orderError;

    orderId = order?.id || "";
    if (!orderId) {
      return res.status(500).json({ error: "Supabase nao retornou o ID do pedido." });
    }

    const { error: orderItemsError } = await getSupabaseAdmin()
      .from("order_items")
      .insert(products.map((product: any) => ({
        orderId,
        productId: product.id,
        name: product.name,
        type: product.type,
        price: product.price,
        url: product.url,
        vendedorId: product.vendedorId,
        bib: product.bib,
        event: product.event,
        checkpoint: product.checkpoint,
        thumbnailUrl: product.thumbnailUrl,
      })));

    if (orderItemsError) throw orderItemsError;

    const handle = process.env.INFINITEPAY_HANDLE;

    if (!handle) {
      return res.status(500).json({ error: "INFINITEPAY_HANDLE nao configurado." });
    }

    const successRedirectUrl = buildSafeCheckoutSuccessUrl(req, successUrl, orderId);

    const phoneDigits = typeof buyer.phone === "string" ? String(buyer.phone).replace(/\D/g, "") : "";
    const phoneE164 = phoneDigits.length >= 10 ? `+55${phoneDigits}` : "";

    // InfinitePay Checkout API (official) - create a proper checkout link with items in cents.
    const checkoutPayload: any = {
      handle,
      order_nsu: orderId,
      redirect_url: successRedirectUrl,
      webhook_url: getInfinitePayWebhookUrl(req),
      items: products.map((product: any) => ({
        quantity: 1,
        price: Math.round(Number(product.price) * 100),
        description: `Download digital - ${String(product.name || "Foto").slice(0, 100)}`,
      })),
    };

    // Customer is optional, but if sent, InfinitePay may require phone_number. Only include when we have it.
    if (phoneE164) {
      checkoutPayload.customer = {
        name: String(buyer.fullName || "").slice(0, 120),
        email: String(buyer.email || "").slice(0, 256),
        phone_number: phoneE164,
      };
    }

    const checkoutResponse = await fetch(getInfinitePayCheckoutEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload),
    });

    if (!checkoutResponse.ok) {
      const message = await checkoutResponse.text();
      await getSupabaseAdmin()
        .from("orders")
        .update({ status: "failed" })
        .eq("id", orderId);
      return res.status(502).json({ error: message || "Falha ao gerar link na InfinitePay." });
    }

    const checkoutData: any = await checkoutResponse.json().catch(() => ({}));
    const checkoutUrlWithOrder =
      checkoutData?.url ||
      checkoutData?.link ||
      checkoutData?.checkout_url ||
      checkoutData?.payment_url ||
      "";

    if (!checkoutUrlWithOrder) {
      await getSupabaseAdmin()
        .from("orders")
        .update({ status: "failed" })
        .eq("id", orderId);
      return res.status(502).json({ error: "Resposta invalida da InfinitePay ao criar link." });
    }

    try {
      assertInfinitePayCheckoutUrl(checkoutUrlWithOrder);
    } catch (error: any) {
      await getSupabaseAdmin()
        .from("orders")
        .update({ status: "failed" })
        .eq("id", orderId);
      return res.status(502).json({ error: error?.message || "URL de checkout invalida." });
    }

    const { error: checkoutUrlError } = await getSupabaseAdmin()
      .from("orders")
      .update({ checkoutUrl: checkoutUrlWithOrder })
      .eq("id", orderId);

    if (checkoutUrlError) throw checkoutUrlError;

    res.json({ url: checkoutUrlWithOrder, orderId, total });
  } catch (error: any) {
    console.error("Erro ao criar checkout:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/checkout/confirm", async (req, res) => {
  const getConfirmationValue = (names: string[]) => {
    const rawQuery = req.body?.raw_query && typeof req.body.raw_query === "object" ? req.body.raw_query : {};

    for (const name of names) {
      const value = req.body?.[name] ?? rawQuery?.[name];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    const lowerNames = new Set(names.map((name) => name.toLowerCase()));
    for (const [key, value] of Object.entries(rawQuery)) {
      if (
        lowerNames.has(String(key).toLowerCase()) &&
        value !== undefined &&
        value !== null &&
        String(value).trim()
      ) {
        return String(value).trim();
      }
    }

    return "";
  };

  const handle = process.env.INFINITEPAY_HANDLE;
  const orderId = getConfirmationValue(["order", "order_nsu", "orderNsu", "orderNSU", "order_id", "orderId"]);
  const transactionNsu = getConfirmationValue([
    "transaction_nsu",
    "transactionNSU",
    "transaction_id",
    "transactionId",
    "nsu",
  ]);
  const slug = getConfirmationValue(["slug", "invoice_slug", "invoiceSlug", "invoice_id", "invoiceId"]);

  if (!handle) {
    return res.status(500).json({ error: "INFINITEPAY_HANDLE nao configurado." });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: "Pedido invalido." });
  }

  const pool = new Pool(getDbConfig());

  try {
    const existingOrder = await pool.query(
      `select id, status, "paymentProvider", "paymentExternalId", "checkoutUrl" from public.orders where id = $1 limit 1`,
      [orderId],
    );
    const order = existingOrder.rows[0];

    if (!order) {
      return res.status(404).json({ error: "Pedido nao encontrado." });
    }

    if (order.paymentProvider !== "infinitepay") {
      return res.status(409).json({ error: "Pedido nao pertence ao provedor InfinitePay." });
    }

    if (order.status === "paid") {
      return res.json({
        paid: true,
        confirmedBy: "order_status",
        paymentExternalId: order.paymentExternalId,
      });
    }

    let paid = false;
    let paymentCheckError = "";

    if (transactionNsu && slug) {
      try {
        const paymentCheck = await checkInfinitePayPayment({ handle, orderId, transactionNsu, slug });
        paid = Boolean(paymentCheck?.paid);
      } catch (error: any) {
        paymentCheckError = error?.message || "Falha ao confirmar pagamento na InfinitePay.";
      }
    }

    if (!paid) {
      return res.status(409).json({
        paid: false,
        message: "Pagamento ainda nao confirmado.",
        source: "checkout-confirm",
        reason: !transactionNsu || !slug ? "missing_confirmation_params" : "payment_check_unpaid",
        paymentCheckError,
      });
    }

    await pool.query(
      `
        update public.orders
        set status = 'paid', "paymentExternalId" = coalesce($1, "paymentExternalId")
        where id = $2
          and "paymentProvider" = 'infinitepay'
          and status in ('pending', 'failed', 'cancelled')
      `,
      [transactionNsu, orderId],
    );

    return res.json({ paid: true, confirmedBy: "payment_check" });
  } finally {
    await pool.end();
  }
});

app.post("/api/media/upload", express.raw({
  type: ["image/*", "video/*", "application/octet-stream"],
  limit: process.env.MEDIA_UPLOAD_LIMIT || "500mb",
}), async (req, res) => {
  const authUser = await getAuthenticatedRequestUser(req);
  const storagePath = decodeHeaderValue(req.header("x-storage-path"));
  const fileName = decodeHeaderValue(req.header("x-file-name")) || storagePath.split("/").pop() || "arquivo";
  const contentType = String(req.header("content-type") || "application/octet-stream");
  const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

  if (!authUser?.id) {
    return res.status(401).json({ error: "Entre novamente no painel para enviar arquivos." });
  }

  if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/") || !storagePath.startsWith(`${authUser.id}/`)) {
    return res.status(403).json({ error: "Caminho de upload invalido para este fotografo." });
  }

  if (fileBuffer.length === 0) {
    return res.status(400).json({ error: "Arquivo vazio ou nao enviado." });
  }

  try {
    const uploaded = usesExternalBucket()
      ? await uploadToExternalBucket(storagePath, fileName, contentType, fileBuffer)
      : (() => {
          throw new Error("MEDIA_STORAGE_PROVIDER deve ser external_bucket para upload de midias.");
        })();

    return res.json({
      path: uploaded.publicUrl || uploaded.path,
      publicUrl: uploaded.publicUrl || uploaded.path,
    });
  } catch (error: any) {
    console.error("Erro ao enviar midia:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel enviar a midia." });
  }
});

app.get("/api/media/storage-stats", async (req, res) => {
  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser?.id) {
      return res.status(401).json({ error: "Acesso admin necessario para consultar storage." });
    }

    const stats = usesExternalBucket()
      ? await getExternalBucketStorageStats()
      : (() => {
          throw new Error("MEDIA_STORAGE_PROVIDER deve ser external_bucket para consultar storage.");
        })();

    return res.json(stats);
  } catch (error: any) {
    console.error("Erro ao consultar storage:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel consultar storage." });
  }
});

app.post("/api/media/sign", async (req, res) => {
  const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : [];
  const uniquePaths = Array.from(new Set(paths)).filter(Boolean).slice(0, 1000);

  if (uniquePaths.length === 0) {
    return res.json({ urls: {} });
  }

  try {
    const entries = await Promise.all(
      uniquePaths.map(async (path) => [path, await createSignedMediaUrl(path, 900)] as const),
    );

    return res.json({ urls: Object.fromEntries(entries) });
  } catch (error: any) {
    console.error("Erro ao assinar midias:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel assinar midias." });
  }
});

app.post("/api/downloads/record", async (req, res) => {
  const orderId = String(req.body?.orderId || "");
  const orderItemId = String(req.body?.orderItemId || "");
  const authUser = await getAuthenticatedRequestUser(req);

  if (!isUuid(orderId) || !isUuid(orderItemId)) {
    return res.status(400).json({ error: "Download invalido." });
  }

  if (!authUser?.id) {
    return res.status(401).json({ error: "Entre novamente para registrar o download." });
  }

  const pool = new Pool(getDbConfig());

  try {
    const itemResult = await pool.query(
      `
        select
          oi.id,
          oi."orderId",
          oi."productId",
          oi."vendedorId",
          o."buyerEmail",
          o."userId",
          o.status
        from public.order_items oi
        join public.orders o on o.id = oi."orderId"
        where oi.id = $1
          and oi."orderId" = $2
        limit 1
      `,
      [orderItemId, orderId],
    );

    const item = itemResult.rows[0];
    if (!item || item.status !== "paid") {
      return res.status(403).json({ error: "Download liberado apenas para pedidos pagos." });
    }

    if (item.userId !== authUser.id) {
      return res.status(403).json({ error: "Este pedido nao pertence ao usuario logado." });
    }

    const ipSource = req.ip || req.socket.remoteAddress || "";
    const ipHash = ipSource
      ? crypto.createHash("sha256").update(ipSource).digest("hex")
      : null;

    await pool.query(
      `
        insert into public.download_events (
          "orderId",
          "orderItemId",
          "productId",
          "vendedorId",
          "buyerEmail",
          "userId",
          "ipHash",
          "userAgent"
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        item.orderId,
        item.id,
        item.productId,
        item.vendedorId,
        item.buyerEmail,
        item.userId,
        ipHash,
        String(req.header("user-agent") || "").slice(0, 500),
      ],
    );

    return res.json({ ok: true });
  } catch (error: any) {
    console.error("Erro ao registrar download:", error);
    return res.status(500).json({ error: "Nao foi possivel registrar o download." });
  } finally {
    await pool.end();
  }
});

app.post("/api/downloads/authorize", async (req, res) => {
  const orderId = String(req.body?.orderId || "");
  const orderItemId = String(req.body?.orderItemId || "");
  const authUser = await getAuthenticatedRequestUser(req);

  if (!isUuid(orderId) || !isUuid(orderItemId)) {
    return res.status(400).json({ error: "Download invalido." });
  }

  if (!authUser?.id) {
    return res.status(401).json({ error: "Entre novamente para baixar sua compra." });
  }

  try {
    const { data: orderItems, error: itemError } = await getSupabaseAdmin()
      .from("order_items")
      .select("*")
      .eq("id", orderItemId)
      .limit(1);

    if (itemError) throw itemError;

    const item = orderItems?.[0];
    if (!item || (item as any).orderId !== orderId) {
      return res.status(404).json({ error: "Item do pedido nao encontrado." });
    }

    const { data: orders, error: orderError } = await getSupabaseAdmin()
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .limit(1);

    if (orderError) throw orderError;

    const order = orders?.[0];
    if (!order || order.status !== "paid") {
      return res.status(403).json({ error: "Download liberado apenas para pedidos pagos." });
    }

    const buyerEmail = String(order.buyerEmail || "").trim().toLowerCase();
    const authEmail = String(authUser.email || "").trim().toLowerCase();
    const belongsToUser = order.userId === authUser.id || (buyerEmail && authEmail && buyerEmail === authEmail);

    if (!belongsToUser) {
      return res.status(403).json({ error: "Este pedido nao pertence ao usuario logado." });
    }

    const { data: products, error: productError } = await getSupabaseAdmin()
      .from("products")
      .select("*")
      .eq("id", (item as any).productId)
      .limit(1);

    if (productError) throw productError;

    const product = products?.[0];

    const ipSource = req.ip || req.socket.remoteAddress || "";
    const ipHash = ipSource
      ? crypto.createHash("sha256").update(ipSource).digest("hex")
      : null;

    const { error: eventError } = await getSupabaseAdmin()
      .from("download_events")
      .insert({
        orderId: (item as any).orderId,
        orderItemId: (item as any).id,
        productId: (item as any).productId,
        vendedorId: (item as any).vendedorId,
        buyerEmail: order.buyerEmail,
        userId: order.userId,
        ipHash,
        userAgent: String(req.header("user-agent") || "").slice(0, 500),
      });

    if (eventError) {
      console.error("Erro ao registrar evento de download:", eventError);
    }

    const signedUrl = await createSignedMediaUrl((item as any).url || (product as any)?.storagePath || "", 300);
    return res.json({ url: signedUrl });
  } catch (error: any) {
    console.error("Erro ao autorizar download:", error);
    return res.status(500).json({ error: "Nao foi possivel autorizar o download." });
  }
});

// Photographer signup can require email confirmation, which may prevent the client from getting an auth session
// to insert into `public.photographers` (RLS). This endpoint registers a pending photographer record for admin approval.
app.post("/api/photographers/request", async (req, res) => {
  let pool: pg.Pool | null = null;

  try {
    const { userId, email, name, bio, cpf, avatar } = req.body ?? {};

    if (typeof email !== "string" || !email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email invalido." });
    }

    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: "Nome invalido." });
    }

    const cpfDigits = onlyCpfDigits(typeof cpf === "string" ? cpf : "");
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return res.status(400).json({ error: "CPF valido e obrigatorio para cadastro de fotografo." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const resolvedId = typeof userId === "string" && userId.trim().length >= 8
      ? userId.trim()
      : `pending:${normalizedEmail}`;

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    const safeBio = typeof bio === "string" ? bio.slice(0, 1000) : "";
    const safeAvatar = typeof avatar === "string" ? avatar.slice(0, 2048) : "";

    await pool.query(
      `
        insert into public.photographers (
          id,
          name,
          email,
          bio,
          avatar,
          cpf,
          verified,
          stats,
          "createdAt",
          "updatedAt"
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          false,
          jsonb_build_object(
            'photos', 0,
            'events', 0,
            'rating', 5,
            'totalEarnings', 0,
            'pendingEarnings', 0,
            'salesCount', 0
          ),
          now(),
          now()
        )
        on conflict (id) do update set
          name = excluded.name,
          email = excluded.email,
          bio = excluded.bio,
          avatar = excluded.avatar,
          cpf = excluded.cpf,
          verified = false,
          "updatedAt" = now()
      `,
      [resolvedId, name.trim(), normalizedEmail, safeBio, safeAvatar, cpfDigits],
    );

    await pool.query("commit");
    res.json({ ok: true });
  } catch (error: any) {
    if (pool) {
      try {
        await pool.query("rollback");
      } catch {
        // ignore
      }
    }

    console.error("Erro ao registrar fotografo pendente:", error);
    res.status(500).json({ error: error.message || "Erro ao registrar fotografo pendente." });
  } finally {
    if (pool) await pool.end();
  }
});

app.post("/api/photographers/password-reset", async (req, res) => {
  let pool: pg.Pool | null = null;

  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email invalido." });
    }

    pool = new Pool(getDbConfig());
    const result = await pool.query(
      `select id from public.photographers where email = $1 limit 1`,
      [email],
    );

    if (result.rowCount && result.rowCount > 0) {
      const resetResult = await getSupabaseAdmin().auth.resetPasswordForEmail(email, {
        redirectTo: getPhotographerPasswordSetupUrl(req),
      });

      if (resetResult.error) throw resetResult.error;
    }

    return res.json({
      ok: true,
      message: "Se este email estiver cadastrado como fotografo, enviaremos um link para definir a senha.",
    });
  } catch (error: any) {
    console.error("Erro ao solicitar definicao de senha:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel enviar o link de senha." });
  } finally {
    if (pool) await pool.end();
  }
});

// After the user confirms email and logs in, claim a pending photographer record (id=pending:<email>) by moving it to auth userId.
app.post("/api/photographers/claim", async (req, res) => {
  let pool: pg.Pool | null = null;

  try {
    const { userId, email } = req.body ?? {};

    if (typeof userId !== "string" || userId.trim().length < 8) {
      return res.status(400).json({ error: "userId invalido." });
    }

    if (typeof email !== "string" || !email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email invalido." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pendingId = `pending:${normalizedEmail}`;

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    // If pending record exists, move it to the real auth uid. Keep verified/status/stats.
    const result = await pool.query(
      `
        with moved as (
          update public.photographers
          set id = $1, "updatedAt" = now()
          where id = $2
          returning *
        )
        select count(*)::int as moved_count from moved
      `,
      [userId.trim(), pendingId],
    );

    await pool.query("commit");
    res.json({ ok: true, moved: result.rows?.[0]?.moved_count ?? 0 });
  } catch (error: any) {
    if (pool) {
      try {
        await pool.query("rollback");
      } catch {
        // ignore
      }
    }

    console.error("Erro ao claim de fotografo pendente:", error);
    res.status(500).json({ error: error.message || "Erro ao claim de fotografo pendente." });
  } finally {
    if (pool) await pool.end();
  }
});

app.post("/api/webhooks/infinitepay", async (req, res) => {
  const payload = req.body;
  const orderId = getWebhookOrderId(payload);
  const transactionNsu = String(
    payload?.transaction_nsu ||
      payload?.transactionNSU ||
      payload?.transaction_id ||
      payload?.transactionId ||
      payload?.id ||
      "",
  );
  const slug = String(payload?.invoice_slug || payload?.invoiceSlug || payload?.slug || "");

  if (getWebhookSecret() && !isValidWebhookSignature(req)) {
    return res.status(401).json({ error: "Assinatura do webhook invalida." });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: "Pedido invalido no webhook." });
  }

  if (!transactionNsu || !slug) {
    return res.status(400).json({ error: "Dados de pagamento incompletos no webhook." });
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return res.status(500).json({ error: "INFINITEPAY_HANDLE nao configurado." });
  }

  let paymentCheck: any = {};
  try {
    paymentCheck = await checkInfinitePayPayment({ handle, orderId, transactionNsu, slug });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Falha ao validar webhook na InfinitePay." });
  }

  const status = paymentCheck?.paid ? "paid" : mapNonPaidPaymentStatus(payload?.status);
  const eventId = getWebhookEventId(payload, orderId, status);
  const paymentExternalId = transactionNsu || null;

  const pool = new Pool(getDbConfig());
  try {
    const eventResult = await pool.query(
      `
        insert into public.payment_events (
          provider,
          "eventId",
          "orderId",
          status,
          payload
        )
        values ('infinitepay', $1, $2, $3, $4::jsonb)
        on conflict (provider, "eventId") do nothing
        returning id
      `,
      [eventId, orderId, status, JSON.stringify({ ...payload, payment_check: paymentCheck })],
    );

    if (eventResult.rowCount === 0) {
      return res.status(200).send("OK");
    }

    if (status === "paid") {
      await pool.query(
        `
          update public.orders
          set status = 'paid', "paymentExternalId" = coalesce($1, "paymentExternalId")
          where id = $2
            and "paymentProvider" = 'infinitepay'
            and status in ('pending', 'failed', 'cancelled')
        `,
        [paymentExternalId, orderId],
      );
    } else if (["failed", "cancelled", "refunded"].includes(status)) {
      await pool.query(
        `
          update public.orders
          set status = $1, "paymentExternalId" = coalesce($2, "paymentExternalId")
          where id = $3
            and "paymentProvider" = 'infinitepay'
            and status <> 'paid'
        `,
        [status, paymentExternalId, orderId],
      );
    }
  } finally {
    await pool.end();
  }

  res.status(200).send("OK");
});

async function setupViteAndListen() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      // In middleware mode, Vite may try to bind an HMR WebSocket server (default 24678).
      // When that port is busy it crashes the whole app, causing client fetches to fail.
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  setupViteAndListen();
}

export default app;
