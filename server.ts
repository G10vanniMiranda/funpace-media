import "dotenv/config";
import express from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import cors from "cors";
import helmet from "helmet";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidCpf, onlyCpfDigits } from "./src/lib/cpf";
import { BULK_PHOTO_DISCOUNT_PERCENT, calculateCartPricing, isPhotoType } from "./src/lib/cart-pricing";
import { getActivePaymentProvider } from "./server/payments/paymentProvider";
import { fulfillPaidOrder, recordPayment } from "./server/shared/checkoutFulfillment";
import { ensurePhotographerReferralCode, markReferralApproved, registerPendingReferral } from "./server/shared/referrals";
import adminApiHandler from "./api/admin";
import downloadEmailHandler from "./api/orders/download-email";
import eventMediaCountsHandler from "./server/api/events/media-counts";
import directUploadHandler from "./server/api/media/direct-upload";
import mediaJobsHandler from "./server/api/media/jobs";
import integrityCronHandler from "./server/api/integrity/cron";
import { startIntegrityScheduler } from "./server/integrity/integrity-service";
import healthHandler from "./server/api/health";
import type { PaymentMethod } from "./server/payments/providers/types";
import { backfillFaceHandler, faceConsentHandler, indexPhotoHandler, searchFaceHandler, testFaceHandler } from "./server/face/face-handlers";
import { shouldBypassFaceBackfillRateLimit } from "./server/face/face-rate-limit";
import { ensureRequestId, errorToLog, getRequestId, logEvent } from "./server/shared/observability";
import { rateLimitAsync as sharedRateLimitAsync } from "./server/shared/security";
import { sendMaintenanceResponse, shouldServeMaintenancePage } from "./server/shared/maintenance";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const { Pool } = pg;
const isLocalViteDevelopment = !process.env.VERCEL && process.env.NODE_ENV !== "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
  strictTransportSecurity: isLocalViteDevelopment ? false : undefined,
}));

function getClientIp(req: express.Request) {
  const forwarded = String(req.header("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || "unknown";
}

function getSecurityCsp() {
  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || "";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const apiUrl = process.env.API_URL || process.env.VITE_API_URL || "";
  const connectSources = [
    "'self'",
    ...(isLocalViteDevelopment ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : []),
    apiUrl,
    "https://api.checkout.infinitepay.io",
    "https://checkout.infinitepay.io",
    "https://*.infinitepay.io",
    "https://99dev.pro",
    supabaseUrl,
    mediaBaseUrl,
  ].filter(Boolean).join(" ");
  const imageSources = [
    "'self'",
    "data:",
    "blob:",
    "https:",
    mediaBaseUrl,
  ].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `connect-src ${connectSources}`,
    `img-src ${imageSources}`,
    "media-src 'self' blob: data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'self'${isLocalViteDevelopment ? " 'unsafe-inline'" : ""}`,
    "form-action 'self' https://*.infinitepay.io",
    ...(!isLocalViteDevelopment ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("Content-Security-Policy", getSecurityCsp());
  if (!isLocalViteDevelopment) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

app.use((req, res, next) => {
  const requestId = ensureRequestId(req, res);
  const startedAt = Date.now();
  res.on("finish", () => {
    if (!req.path.startsWith("/api/")) return;
    const durationMs = Date.now() - startedAt;
    if (res.statusCode < 400 && durationMs < Number(process.env.SLOW_REQUEST_LOG_MS || 1500)) return;
    logEvent(res.statusCode >= 500 ? "error" : "info", "http_request", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });
  next();
});

function normalizeOriginValue(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

function getAllowedOrigins() {
  return new Set([
    "https://funpace.media",
    "https://www.funpace.media",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    process.env.FRONTEND_URL,
    process.env.VITE_FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
    ...(process.env.CORS_ORIGINS || "").split(","),
  ].filter((origin): origin is string => Boolean(origin?.trim())).map(normalizeOriginValue));
}

const allowedOrigins = getAllowedOrigins();

function isAllowedRequestOrigin(value: string) {
  try {
    const origin = normalizeOriginValue(new URL(value).origin);
    return allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

function logBlockedOrigin(req: express.Request, input: { source: "cors" | "browser-origin"; origin?: string; referer?: string }) {
  if (process.env.NODE_ENV !== "production" && process.env.CORS_DEBUG !== "true") return;

  logEvent("warn", "origin_blocked", {
    requestId: getRequestId(req),
    source: input.source,
    method: req.method,
    path: req.originalUrl || req.url,
    origin: input.origin || null,
    referer: input.referer || null,
    userAgent: req.header("user-agent") || null,
  });
}

function rejectUntrustedBrowserOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.header("origin");
  const referer = req.header("referer");

  if ((origin && !isAllowedRequestOrigin(origin)) || (!origin && referer && !isAllowedRequestOrigin(referer))) {
    logBlockedOrigin(req, { source: "browser-origin", origin, referer });
    res.status(403).json({ error: "Origem nao autorizada." });
    return;
  }

  next();
}

function createRateLimiter(options: { windowMs: number; max: number; keyPrefix: string; skip?: (req: express.Request) => boolean }) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (options.skip?.(req)) {
      next();
      return;
    }
    if (await sharedRateLimitAsync(req, res, options)) return;
    next();
  };
}

app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOriginValue(origin);
      if (allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      logBlockedOrigin(req, {
        source: "cors",
        origin: normalizedOrigin,
        referer: req.header("referer"),
      });
      callback(new Error("Origem nao permitida pelo CORS."));
    },
  })(req, res, next);
});

app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "200kb",
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));

app.use(rejectUntrustedBrowserOrigin);
app.use("/api", createRateLimiter({
  keyPrefix: "api",
  windowMs: 15 * 60 * 1000,
  max: 900,
  skip: shouldBypassFaceBackfillRateLimit,
}));
app.use(["/api/checkout", "/api/downloads", "/api/photographers"], createRateLimiter({
  keyPrefix: "sensitive",
  windowMs: 60 * 1000,
  max: 60,
}));
app.use(["/api/media/upload"], createRateLimiter({
  keyPrefix: "media-upload",
  windowMs: 60 * 1000,
  max: 300,
}));
app.use(["/api/media/sign"], createRateLimiter({
  keyPrefix: "media-sign",
  windowMs: 60 * 1000,
  max: 60,
}));
app.use(["/api/face/backfill"], createRateLimiter({
  keyPrefix: "face-backfill",
  windowMs: 60 * 1000,
  max: 4,
  skip: shouldBypassFaceBackfillRateLimit,
}));
app.use(["/api/products"], createRateLimiter({
  keyPrefix: "product-engagement",
  windowMs: 60 * 1000,
  max: 120,
}));
app.use(["/api/content-protection"], createRateLimiter({
  keyPrefix: "content-protection",
  windowMs: 60 * 1000,
  max: 120,
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
const uploadProviderTimeoutMs = Number(process.env.MEDIA_UPLOAD_PROVIDER_TIMEOUT_MS || 600_000);
const uploadVerifyTimeoutMs = Number(process.env.MEDIA_UPLOAD_VERIFY_TIMEOUT_MS || 30_000);

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

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCouponCode(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
}

function devSignupLog(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[photographer-signup] ${message}`, metadata || {});
}

const WELCOME_VOUCHER_CODE = "FUNPACE10";
const WELCOME_VOUCHER_PERCENT = 10;

async function hasPaidCustomerOrder(input: { userId: string; email?: string | null }) {
  const userId = String(input.userId || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!userId && !email) return false;

  let query = getSupabaseAdmin()
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .limit(1);

  query = email ? query.or(`userId.eq.${userId},buyerEmail.eq.${email}`) : query.eq("userId", userId);
  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

async function validateCheckoutCoupon(input: { code: string; subtotal: number; itemCount: number; firstPurchaseEligible?: boolean }) {
  const code = normalizeCouponCode(input.code);
  if (!code) return { coupon: null as any, discountTotal: 0 };
  if (code.length < 3) throw new Error("Cupom invalido.");
  if (code === WELCOME_VOUCHER_CODE && input.firstPurchaseEligible === false) {
    throw new Error("O cupom FUNPACE10 e valido apenas para a primeira compra.");
  }

  const { data: coupon, error } = await getSupabaseAdmin()
    .from("coupons")
    .select("*")
    .eq("code", code)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const resolvedCoupon = coupon || (code === WELCOME_VOUCHER_CODE ? {
    id: null,
    code: WELCOME_VOUCHER_CODE,
    type: "percent",
    value: WELCOME_VOUCHER_PERCENT,
    usedCount: 0,
    maxUses: null,
    isActive: true,
  } : null);
  if (!resolvedCoupon || !(resolvedCoupon as any).isActive) throw new Error("Cupom invalido ou inativo.");

  const now = Date.now();
  if ((resolvedCoupon as any).startsAt && new Date((resolvedCoupon as any).startsAt).getTime() > now) {
    throw new Error("Cupom ainda nao esta valido.");
  }
  if ((resolvedCoupon as any).expiresAt && new Date((resolvedCoupon as any).expiresAt).getTime() < now) {
    throw new Error("Cupom expirado.");
  }
  if ((resolvedCoupon as any).maxUses !== null && (resolvedCoupon as any).maxUses !== undefined && Number((resolvedCoupon as any).usedCount || 0) >= Number((resolvedCoupon as any).maxUses)) {
    throw new Error("Cupom esgotado.");
  }

  const subtotalCents = Math.round(input.subtotal * 100);
  const minimumTotalCents = Math.max(101, input.itemCount);
  const maxDiscountCents = Math.max(0, subtotalCents - minimumTotalCents);
  const requestedDiscountCents = (resolvedCoupon as any).type === "percent"
    ? Math.floor(subtotalCents * Math.min(100, Math.max(0, Number((resolvedCoupon as any).value))) / 100)
    : Math.round(Number((resolvedCoupon as any).value) * 100);
  const discountCents = Math.min(maxDiscountCents, Math.max(0, requestedDiscountCents));

  if (discountCents <= 0) throw new Error("Cupom nao pode ser aplicado a este carrinho.");
  return { coupon: resolvedCoupon, discountTotal: roundMoney(discountCents / 100) };
}

function getAutomaticCheckoutDiscount(products: any[]) {
  const pricing = calculateCartPricing(products.map((product) => ({
    id: String(product.id),
    price: Number(product.price || 0),
    type: product.type,
  })));

  return {
    type: pricing.automaticDiscountActive ? "bulk_photo_quantity" : null,
    percentage: pricing.automaticDiscountPercent,
    discountTotal: pricing.automaticDiscountTotal,
    eligibleProductIds: new Set(products.filter((product) => isPhotoType(product.type)).map((product) => String(product.id))),
  };
}

function applyCheckoutDiscountToProducts(products: any[], discountTotal: number, eligibleProductIds?: Set<string>) {
  const discountCents = Math.round(discountTotal * 100);
  if (discountCents <= 0) return products.map((product) => ({ ...product, checkoutPrice: roundMoney(Number(product.price || 0)) }));

  const eligibleProducts = eligibleProductIds
    ? products.filter((product) => eligibleProductIds.has(String(product.id)))
    : products;
  const subtotalCents = eligibleProducts.reduce((sum, product) => sum + Math.round(Number(product.price || 0) * 100), 0);
  if (subtotalCents <= 0) return products.map((product) => ({ ...product, checkoutPrice: roundMoney(Number(product.price || 0)) }));

  let remainingDiscount = discountCents;
  const adjusted = products.map((product) => {
    const originalCents = Math.round(Number(product.price || 0) * 100);
    if (eligibleProductIds && !eligibleProductIds.has(String(product.id))) {
      return { ...product, checkoutPrice: roundMoney(originalCents / 100) };
    }

    const eligibleIndex = eligibleProducts.findIndex((item) => String(item.id) === String(product.id));
    const proportional = eligibleIndex === eligibleProducts.length - 1
      ? remainingDiscount
      : Math.floor(discountCents * originalCents / subtotalCents);
    const itemDiscount = Math.min(Math.max(0, proportional), Math.max(0, originalCents - 1), remainingDiscount);
    remainingDiscount -= itemDiscount;
    return { ...product, checkoutPrice: roundMoney((originalCents - itemDiscount) / 100) };
  });

  for (const product of adjusted) {
    if (remainingDiscount <= 0) break;
    if (eligibleProductIds && !eligibleProductIds.has(String(product.id))) continue;
    const cents = Math.round(Number(product.checkoutPrice || 0) * 100);
    const extra = Math.min(remainingDiscount, Math.max(0, cents - 1));
    if (extra > 0) {
      product.checkoutPrice = roundMoney((cents - extra) / 100);
      remainingDiscount -= extra;
    }
  }

  return adjusted;
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

async function isVerifiedPhotographerUser(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("photographers")
    .select("id,verified")
    .eq("id", userId)
    .eq("verified", true)
    .maybeSingle();

  return !error && Boolean(data?.id);
}

async function getAuthenticatedAdminUser(req: express.Request): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.id) return null;

  const role = String(data.user.app_metadata?.role || "");
  if (role !== "admin" && role !== "super_admin") return null;

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

const reservedRootSlugs = new Set([
  "admin",
  "api",
  "auth",
  "busca",
  "cadastro",
  "carrinho",
  "checkout",
  "contato",
  "dashboard",
  "evento",
  "eventos",
  "faq",
  "fotografo",
  "login",
  "minha-conta",
  "minhas-compras",
  "pagar",
  "pagamento",
  "para-fotografos",
  "perfil",
  "precos",
  "privacidade",
  "termos",
  "upload",
]);

function normalizePublicSlug(value: string) {
  return value
    .replace(/^@/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getRootPublicSlug(pathname: string) {
  const match = pathname.match(/^\/@?([^/?#]+)\/?$/);
  if (!match) return "";
  const slug = normalizePublicSlug(decodeURIComponent(match[1] || ""));
  return slug && !reservedRootSlugs.has(slug) ? slug : "";
}

function getPublicEventSlug(pathname: string) {
  const match = pathname.match(/^\/evento\/([^/?#]+)\/?$/);
  if (!match) return "";
  return normalizePublicSlug(decodeURIComponent(match[1] || ""));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getPublicPhotographerMeta(slug: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("photographers")
    .select("username,slug,name,displayName,bio,city,avatar,profilePhoto,coverPhoto,verified,isPublic")
    .or(`username.eq.${slug},slug.eq.${slug}`)
    .eq("verified", true)
    .eq("isPublic", true)
    .maybeSingle();

  if (error || !data) return null;

  const displayName = String((data as any).displayName || (data as any).name || "Fotografo Funpace");
  const publicSlug = String((data as any).username || (data as any).slug || slug);
  const description = `Perfil publico de ${displayName}${(data as any).city ? ` em ${(data as any).city}` : ""}: eventos, albuns e fotos na Funpace Media.`;
  return {
    title: `${displayName} - Fotografo Oficial | Funpace Media`,
    description,
    image: String((data as any).coverPhoto || (data as any).profilePhoto || (data as any).avatar || ""),
    slug: publicSlug,
  };
}

async function getPublicEventMeta(slug: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("events")
    .select("slug,name,description,date,location,checkpoint,coverImage,bannerImage,isPublished,status")
    .eq("slug", slug)
    .eq("isPublished", true)
    .maybeSingle();

  if (error || !data) return null;

  const eventName = String((data as any).name || "Evento Funpace");
  const location = String((data as any).location || (data as any).checkpoint || "").trim();
  const date = String((data as any).date || "").trim();
  const fallbackDescription = [
    `Fotos e videos oficiais do evento ${eventName} na Funpace Media.`,
    location ? `Local: ${location}.` : "",
    date ? `Data: ${date}.` : "",
    "Use busca por selfie para encontrar suas fotos com privacidade.",
  ].filter(Boolean).join(" ");

  return {
    title: `${eventName} | Fotos e Videos Funpace Media`,
    description: String((data as any).description || fallbackDescription).slice(0, 220),
    image: createPublicMediaUrl(String((data as any).bannerImage || (data as any).coverImage || "")),
    slug: String((data as any).slug || slug),
    type: "article" as const,
  };
}

function injectSeoMeta(html: string, meta: { title: string; description: string; image: string; url: string; type?: "website" | "article" | "profile" }) {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(meta.url)}">`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:type" content="${escapeHtml(meta.type || "website")}">`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}">`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}">` : "",
  ].filter(Boolean).join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/i, "")
    .replace(/<link rel="canonical"[^>]*>/i, "")
    .replace(/<meta name="description"[^>]*>/i, "")
    .replace(/<meta property="og:title"[^>]*>/i, "")
    .replace(/<meta property="og:description"[^>]*>/i, "")
    .replace(/<meta property="og:type"[^>]*>/i, "")
    .replace(/<meta property="og:url"[^>]*>/i, "")
    .replace(/<meta property="og:image"[^>]*>/i, "")
    .replace(/<meta name="twitter:title"[^>]*>/i, "")
    .replace(/<meta name="twitter:description"[^>]*>/i, "")
    .replace(/<meta name="twitter:image"[^>]*>/i, "")
    .replace("</head>", `    ${tags}\n  </head>`);
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

function createSupabaseStoragePublicUrl(bucket: string, path: string) {
  const { supabaseUrl } = getSupabaseApiConfig();
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

async function ensurePublicImageBucket(bucket: string, options: { fileSizeLimit: number }) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: getError } = await supabase.storage.getBucket(bucket);

  if (existing?.id) {
    if (!existing.public || existing.file_size_limit !== options.fileSizeLimit) {
      const { error: updateError } = await supabase.storage.updateBucket(bucket, {
        public: true,
        fileSizeLimit: options.fileSizeLimit,
        allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
      });
      if (updateError) throw updateError;
    }
    return;
  }

  if (getError && !/not found|does not exist|404/i.test(String(getError.message || ""))) {
    throw getError;
  }

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: options.fileSizeLimit,
    allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  });

  if (createError && !/already exists/i.test(String(createError.message || ""))) {
    throw createError;
  }
}

async function uploadSupabaseProfileImage(input: { bucket: string; path: string; contentType: string; fileBuffer: Buffer; fileSizeLimit: number }) {
  await ensurePublicImageBucket(input.bucket, { fileSizeLimit: input.fileSizeLimit });

  const { error } = await getSupabaseAdmin().storage
    .from(input.bucket)
    .upload(input.path, input.fileBuffer, {
      contentType: input.contentType,
      upsert: true,
      cacheControl: "31536000",
    });

  if (error) throw error;

  return {
    path: input.path,
    publicUrl: createSupabaseStoragePublicUrl(input.bucket, input.path),
  };
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
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), uploadProviderTimeoutMs);
  const formData = new FormData();
  const safeFileName = path.split("/").pop() || fileName || "arquivo";

  formData.set("bucket", bucket);
  formData.set("arquivo", new Blob([buffer], { type: contentType || "application/octet-stream" }), safeFileName);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers: {
        "X-API-Token": token,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Upload externo excedeu ${Math.round(uploadProviderTimeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

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
  console.info("[media-upload] provider:done", {
    bucket,
    path,
    status: response.status,
    durationMs: Date.now() - startedAt,
    returnedUrl: Boolean(publicUrl),
  });
  return {
    path: publicUrl || payload?.path || payload?.key || path,
    publicUrl,
    providerPayload: payload,
  };
}

async function verifyUploadedMedia(uploaded: { path: string; publicUrl?: string }) {
  const url = uploaded.publicUrl || uploaded.path;
  if (!/^https?:\/\//i.test(url)) {
    return { verified: true, skipped: "non-http-path" };
  }

  const startedAt = Date.now();
  let lastMessage = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), uploadVerifyTimeoutMs);
    try {
      const response = await fetch(url, { method: "HEAD", signal: controller.signal });
      if (response.ok) {
        return { verified: true, status: response.status, durationMs: Date.now() - startedAt };
      }
      if ([403, 405].includes(response.status)) {
        const getResponse = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: controller.signal });
        if (getResponse.ok || getResponse.status === 206) {
          return { verified: true, status: getResponse.status, durationMs: Date.now() - startedAt };
        }
        lastMessage = `HTTP ${getResponse.status}`;
      } else {
        lastMessage = `HTTP ${response.status}`;
      }
    } catch (error: any) {
      lastMessage = error?.name === "AbortError"
        ? `timeout ${Math.round(uploadVerifyTimeoutMs / 1000)}s`
        : String(error?.message || error || "falha ao verificar arquivo");
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  throw new Error(`Upload gravado pelo provedor, mas a confirmacao do Storage falhou: ${lastMessage}.`);
}

let bucketFileChecksumCache: { expiresAt: number; files: any[] } | null = null;

async function listExternalBucketFilesCached() {
  const now = Date.now();
  if (bucketFileChecksumCache && bucketFileChecksumCache.expiresAt > now) {
    return bucketFileChecksumCache.files;
  }

  const { baseUrl, token, bucket } = getExternalBucketConfig();
  const files: any[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetch(`${baseUrl}/files?bucket=${encodeURIComponent(bucket)}&page=${page}&per_page=100`, {
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
    files.push(...(Array.isArray(payload?.files) ? payload.files : []));
    totalPages = Number(payload?.pagination?.total_pages || 1);
    page += 1;
  } while (page <= totalPages);

  const activeFiles = files.filter((file: any) => !file?.deleted_at && file?.status !== "deleted" && file?.storage_exists !== false);
  bucketFileChecksumCache = {
    expiresAt: now + 30_000,
    files: activeFiles,
  };
  return activeFiles;
}

async function findExistingBucketFileByChecksum(fileHash: string, contentType: string) {
  if (!fileHash || fileHash.length !== 64) return null;
  const activeFiles = await listExternalBucketFilesCached();
  const normalizedContentType = contentType.toLowerCase();
  return activeFiles
    .filter((file: any) => String(file?.checksum_sha256 || "").toLowerCase() === fileHash)
    .filter((file: any) => {
      const mimeType = String(file?.mime_type || "").toLowerCase();
      if (!mimeType || !normalizedContentType) return true;
      if (normalizedContentType.startsWith("image/")) return mimeType.startsWith("image/");
      if (normalizedContentType.startsWith("video/")) return mimeType.startsWith("video/");
      return true;
    })
    .sort((left: any, right: any) => String(left.created_at || "").localeCompare(String(right.created_at || "")))[0] || null;
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

function isValidCartProductId(value: unknown) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !/[(),]/.test(value);
}

function normalizeVisitorId(value: unknown) {
  return String(value || "").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80);
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
  if (["rejected", "denied", "refused"].includes(normalized)) return "refused";
  if (["failed", "expired"].includes(normalized)) return "failed";
  if (["cancelled", "canceled", "voided"].includes(normalized)) return "canceled";
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
    process.env.VITE_FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
    ...(process.env.CORS_ORIGINS || "").split(","),
  ].filter((origin) => Boolean(String(origin || "").trim())).map((origin) => normalizeOriginValue(String(origin))));
}

function buildSafeCheckoutSuccessUrl(req: express.Request, inputUrl: string | undefined, orderId: string) {
  const fallback = `${getRequestOrigin(req)}/checkout/sucesso`;
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

    const redirectUrl = `${getFrontendUrl()}/checkout/sucesso?order_id=${encodeURIComponent(orderId)}`;
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

app.get("/api/health", healthHandler);

app.get("/api/events/media-counts", eventMediaCountsHandler);
app.post("/api/media/direct-upload", directUploadHandler);
app.all("/api/media/jobs", mediaJobsHandler);
app.all("/api/media/jobs/process", mediaJobsHandler);

app.all([
  "/api/admin",
  "/api/admin/snapshot",
  "/api/admin/orders/status",
  "/api/admin/payments/recovery",
  "/api/admin/integrity",
  "/api/admin/integrity/run",
  "/api/admin/integrity/review/:id",
], async (req, res) => {
  return adminApiHandler(req, res);
});

app.post("/api/integrity/cron", async (req, res) => {
  return integrityCronHandler(req, res);
});

app.all("/api/orders/download-email", async (req, res) => {
  return downloadEmailHandler(req, res);
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
    const instagram = typeof req.body?.instagram === "string"
      ? req.body.instagram.trim().replace(/^@+/, "").toLowerCase()
      : "";

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Nome do fotografo invalido." });
    }

    if (!email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email do fotografo invalido." });
    }

    if (instagram && (instagram.length > 29 || !/^[a-z0-9._]+$/.test(instagram))) {
      return res.status(400).json({ error: "Instagram do fotografo invalido." });
    }

    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    const pendingId = `pending:${email}`;
    const safeInstagram = instagram ? `@${instagram}` : null;

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    await pool.query(
      `
        insert into public.photographers (
          id,
          name,
          email,
          instagram,
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
        on conflict (email) do update set
          name = excluded.name,
          instagram = coalesce(excluded.instagram, public.photographers.instagram),
          bio = excluded.bio,
          avatar = coalesce(nullif(public.photographers.avatar, ''), excluded.avatar),
          stats = coalesce(public.photographers.stats, excluded.stats),
          "updatedAt" = now()
      `,
      [pendingId, name, email, safeInstagram, bio, avatar],
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

async function handleAdminPhotographerStatus(req: express.Request, res: express.Response, action: "disable" | "reactivate") {
  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) {
      return res.status(403).json({ error: "Apenas administradores podem alterar fotografos." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "ID do fotografo e obrigatorio." });

    const supabase = getSupabaseAdmin();
    const existing = await supabase
      .from("photographers")
      .select("id,name,email,verified,blockedAt,referralCode,username,slug,displayName")
      .eq("id", id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data?.id) return res.status(404).json({ error: "Fotografo nao encontrado." });

    const patch = action === "disable"
      ? { verified: false, approved: false, status: "pending", blockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      : { verified: true, approved: true, status: "active", isPublic: true, blockedAt: null, updatedAt: new Date().toISOString() };

    const { data, error } = await supabase
      .from("photographers")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) return res.status(404).json({ error: "Fotografo nao encontrado." });
    if (action === "reactivate") {
      await ensurePhotographerReferralCode(data);
      await markReferralApproved(id);
      devSignupLog("Aprovado; login liberado", { photographerId: id });
    }

    return res.json({
      ok: true,
      photographer: data,
      message: action === "disable" ? "Fotografo desativado com sucesso." : "Fotografo reativado com sucesso.",
    });
  } catch (error: any) {
    console.error("Erro ao alterar fotografo pelo admin:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel concluir a operacao." });
  }
}

app.patch("/api/admin/photographers/:id/disable", (req, res) => {
  return handleAdminPhotographerStatus(req, res, "disable");
});

app.patch("/api/admin/photographers/:id/reactivate", (req, res) => {
  return handleAdminPhotographerStatus(req, res, "reactivate");
});

app.patch("/api/admin/referrals/:id/:action", async (req, res) => {
  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) {
      return res.status(403).json({ error: "Apenas administradores podem alterar indicacoes." });
    }

    const id = String(req.params.id || "").trim();
    const action = String(req.params.action || "").trim();
    if (!isUuid(id)) return res.status(400).json({ error: "ID da indicacao invalido." });

    const now = new Date().toISOString();
    let patch: Record<string, any> | null = null;
    if (action === "approve") {
      patch = { status: "approved", approvedAt: now };
    } else if (action === "cancel") {
      patch = { status: "canceled", rewardStatus: "canceled", canceledAt: now };
    } else if (action === "mark_paid") {
      patch = { status: "rewarded", rewardStatus: "paid", paidAt: now };
    }

    if (!patch) return res.status(400).json({ error: "Acao invalida." });

    const { data, error } = await getSupabaseAdmin()
      .from("photographer_referrals")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) return res.status(404).json({ error: "Indicacao nao encontrada." });

    await getSupabaseAdmin().from("admin_activity_logs").insert({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `referral_${action}`,
      targetType: "photographer_referral",
      targetId: id,
      metadata: patch,
      createdAt: now,
    }).then(({ error: logError }) => {
      if (logError) console.warn("Nao foi possivel registrar auditoria da indicacao:", logError);
    });

    return res.json({ ok: true, referral: data });
  } catch (error: any) {
    console.error("Erro ao atualizar indicacao:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel atualizar a indicacao." });
  }
});

app.delete("/api/admin/photographers/:id", async (req, res) => {
  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) {
      return res.status(403).json({ error: "Apenas administradores podem excluir fotografos." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "ID do fotografo e obrigatorio." });

    const supabase = getSupabaseAdmin();
    const existing = await supabase
      .from("photographers")
      .select("id,name,email")
      .eq("id", id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data?.id) return res.status(404).json({ error: "Fotografo nao encontrado." });

    const { error } = await supabase
      .from("photographers")
      .delete()
      .eq("id", id);
    if (error) throw error;

    return res.json({
      ok: true,
      deletedId: id,
      message: "Fotografo excluido com sucesso.",
    });
  } catch (error: any) {
    console.error("Erro ao excluir fotografo pelo admin:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel excluir o fotografo." });
  }
});

app.post("/api/checkout/create-session", async (req, res) => {
  let orderId = "";

  try {
    const { items, successUrl, cancelUrl, buyer, couponCode } = req.body;
    const paymentMethod: PaymentMethod = req.body?.paymentMethod === "pix" || req.body?.paymentMethod === "credit_card"
      ? req.body.paymentMethod
      : "checkout";
    const authUser = await getAuthenticatedRequestUser(req);

    if (!authUser?.id) {
      return res.status(401).json({ error: "Entre novamente para iniciar o pagamento." });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: "Dados do comprador incompletos." });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio." });
    }

    const productIds = [...new Set(items.map((item: any) => String(item.id || "").trim()))].filter(Boolean);
    if (productIds.length !== items.length || productIds.some((id) => !isValidCartProductId(id))) {
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

    const subtotal = roundMoney(products.reduce((sum: number, product: any) => sum + Number(product.price), 0));
    const inputBuyerEmail = String(buyer.email).trim().toLowerCase();
    if (authUser.email && inputBuyerEmail && inputBuyerEmail !== authUser.email) {
      return res.status(403).json({ error: "Use o mesmo e-mail da conta logada para finalizar a compra." });
    }

    const buyerEmail = authUser.email || inputBuyerEmail;
    const firstPurchaseEligible = !(await hasPaidCustomerOrder({ userId: authUser.id, email: buyerEmail }));
    let couponResult;
    try {
      couponResult = await validateCheckoutCoupon({ code: couponCode, subtotal, itemCount: products.length, firstPurchaseEligible });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Cupom invalido." });
    }
    const automaticDiscount = getAutomaticCheckoutDiscount(products);
    const couponDiscountTotal = Number(couponResult.discountTotal || 0);
    const useCouponDiscount = couponResult.coupon && couponDiscountTotal >= automaticDiscount.discountTotal;
    const discountTotal = useCouponDiscount ? couponDiscountTotal : automaticDiscount.discountTotal;
    const discountType = discountTotal > 0 ? useCouponDiscount ? "coupon" : automaticDiscount.type : null;
    const discountPercentage = discountType === "bulk_photo_quantity" ? BULK_PHOTO_DISCOUNT_PERCENT : null;
    const total = roundMoney(subtotal - discountTotal);
    const checkoutProducts = applyCheckoutDiscountToProducts(
      products,
      discountTotal,
      discountType === "bulk_photo_quantity" ? automaticDiscount.eligibleProductIds : undefined,
    );
    const buyerCpf = onlyCpfDigits(typeof buyer?.cpf === "string" ? buyer.cpf : "");
    console.info("[checkout] buyer cpf received", {
      hasCpf: buyerCpf.length > 0,
      cpfLength: buyerCpf.length,
      cpfValid: isValidCpf(buyerCpf),
    });
    if (!isValidCpf(buyerCpf)) {
      return res.status(400).json({ error: "Informe um CPF valido para continuar o pagamento." });
    }
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
        cpf: buyerCpf || null,
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
        subtotal,
        discountTotal,
        status: "pending",
        paymentMethod,
        paymentProvider: process.env.PAYMENT_PROVIDER || "infinitepay",
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
      .insert(checkoutProducts.map((product: any) => ({
        orderId,
        productId: product.id,
        name: product.name,
        type: product.type,
        price: product.checkoutPrice,
        url: product.url,
        vendedorId: product.vendedorId,
        bib: product.bib,
        event: product.event,
        checkpoint: product.checkpoint,
        thumbnailUrl: product.thumbnailUrl,
      })));

    if (orderItemsError) throw orderItemsError;

    const successRedirectUrl = buildSafeCheckoutSuccessUrl(req, successUrl, orderId);
    const provider = getActivePaymentProvider();
    let paymentResult;
    try {
      console.info("[checkout] provider payload source", {
        orderId,
        provider: provider.name,
        hasCpf: buyerCpf.length === 11,
        cpfLength: buyerCpf.length,
      });
      paymentResult = await provider.createCheckout({
        orderId,
        buyer: {
          fullName: buyerName,
          email: buyerEmail,
          phone: buyerPhone,
          cpf: buyerCpf,
        },
        items: checkoutProducts.map((product: any) => ({
          id: product.id,
          name: product.name,
          price: Number(product.checkoutPrice),
        })),
        paymentMethod,
        successUrl: successRedirectUrl,
        cancelUrl: typeof cancelUrl === "string" ? cancelUrl : undefined,
        webhookUrl: `${getRequestOrigin(req)}/api/webhooks/${provider.name}`,
      });
    } catch (error: any) {
      await getSupabaseAdmin()
        .from("orders")
        .update({ status: "failed" })
        .eq("id", orderId);
      return res.status(502).json({ error: error?.message || `Falha ao gerar checkout com ${provider.name}.` });
    }

    await recordPayment({
      orderId,
      provider: paymentResult.provider,
      providerPaymentId: paymentResult.providerPaymentId || orderId,
      method: paymentResult.method,
      status: paymentResult.status,
      rawResponse: paymentResult.rawResponse,
    });

    const { error: checkoutUrlError } = await getSupabaseAdmin()
      .from("orders")
      .update({
        checkoutUrl: paymentResult.checkoutUrl,
        paymentExternalId: paymentResult.providerPaymentId,
        paymentProvider: paymentResult.provider,
      })
      .eq("id", orderId);

    if (checkoutUrlError) throw checkoutUrlError;

    if (useCouponDiscount && (couponResult.coupon as any)?.id) {
      await getSupabaseAdmin()
        .from("coupons")
        .update({ usedCount: Number((couponResult.coupon as any).usedCount || 0) + 1 })
        .eq("id", (couponResult.coupon as any).id)
        .then(({ error }) => {
          if (error) console.error("Nao foi possivel atualizar uso do cupom:", error);
        });
    }

    res.json({
      url: paymentResult.checkoutUrl,
      paymentUrl: paymentResult.checkoutUrl,
      orderId,
      total,
      subtotal,
      discountTotal,
      discountType,
      discountPercentage,
      couponCode: useCouponDiscount ? (couponResult.coupon as any)?.code || null : null,
      automaticDiscountTotal: automaticDiscount.discountTotal,
      automaticDiscountEligible: automaticDiscount.discountTotal > 0,
      discountRule: "coupon_nao_acumula_melhor_beneficio",
      paymentMethod,
      provider: paymentResult.provider,
      status: paymentResult.status,
      pix: paymentResult.pix || null,
    });
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
          and status in ('pending', 'failed', 'cancelled', 'canceled', 'refused')
      `,
      [transactionNsu, orderId],
    );

    await recordPayment({
      orderId,
      provider: "infinitepay",
      providerPaymentId: transactionNsu || orderId,
      method: "checkout",
      status: "paid",
      rawResponse: { source: "checkout-confirm", transactionNsu, slug },
    });
    await fulfillPaidOrder(orderId);

    return res.json({ paid: true, confirmedBy: "payment_check" });
  } finally {
    await pool.end();
  }
});

app.post("/api/media/upload", express.raw({
  type: ["image/*", "video/*", "application/octet-stream"],
  limit: process.env.MEDIA_UPLOAD_LIMIT || "300mb",
}), async (req, res) => {
  const authUser = await getAuthenticatedRequestUser(req);
  const storagePath = decodeHeaderValue(req.header("x-storage-path"));
  const fileName = decodeHeaderValue(req.header("x-file-name")) || storagePath.split("/").pop() || "arquivo";
  const fileHash = String(req.header("x-file-hash") || "").trim().toLowerCase();
  const uploadBatchId = String(req.header("x-upload-batch-id") || "").trim();
  const contentType = String(req.header("content-type") || "application/octet-stream");
  const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  const requestStartedAt = Date.now();

  if (!authUser?.id) {
    return res.status(401).json({ error: "Entre novamente no painel para enviar arquivos." });
  }

  if (!(await isVerifiedPhotographerUser(authUser.id))) {
    return res.status(403).json({ error: "Apenas fotografos aprovados podem enviar midias." });
  }

  if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/") || !storagePath.startsWith(`${authUser.id}/`)) {
    return res.status(403).json({ error: "Caminho de upload invalido para este fotografo." });
  }

  if (fileBuffer.length === 0) {
    return res.status(400).json({ error: "Arquivo vazio ou nao enviado." });
  }

  try {
    if (fileHash) {
      const existingFile = await findExistingBucketFileByChecksum(fileHash, contentType);
      if (existingFile?.url) {
        return res.json({
          path: existingFile.url,
          publicUrl: existingFile.url,
          fileHash,
          uploadBatchId: uploadBatchId || undefined,
          reused: true,
        });
      }
    }

    console.info("[media-upload] start", {
      bucket: mediaBucket,
      storagePath,
      fileName,
      contentType,
      size: fileBuffer.length,
      photographerId: authUser.id,
      uploadBatchId: uploadBatchId || null,
      fileHash: fileHash || null,
    });

    const uploaded = usesExternalBucket()
      ? await uploadToExternalBucket(storagePath, fileName, contentType, fileBuffer)
      : (() => {
        throw new Error("MEDIA_STORAGE_PROVIDER deve ser external_bucket para upload de midias.");
      })();
    const verification = await verifyUploadedMedia(uploaded);

    console.info("[media-upload] done", {
      bucket: mediaBucket,
      storagePath,
      publicUrl: uploaded.publicUrl || uploaded.path,
      photographerId: authUser.id,
      uploadBatchId: uploadBatchId || null,
      verified: verification.verified,
      durationMs: Date.now() - requestStartedAt,
    });

    return res.json({
      path: uploaded.publicUrl || uploaded.path,
      publicUrl: uploaded.publicUrl || uploaded.path,
      fileHash: fileHash || undefined,
      uploadBatchId: uploadBatchId || undefined,
      reused: false,
      verified: verification.verified,
    });
  } catch (error: any) {
    console.error("[media-upload] error", {
      bucket: mediaBucket,
      storagePath,
      fileName,
      contentType,
      size: fileBuffer.length,
      photographerId: authUser?.id || null,
      uploadBatchId: uploadBatchId || null,
      provider: usesExternalBucket() ? "external_bucket" : mediaStorageProvider,
      durationMs: Date.now() - requestStartedAt,
      message: error?.message || String(error),
    });
    return res.status(500).json({ error: error?.message || "Nao foi possivel enviar a midia." });
  }
});

app.post("/api/face/index", express.raw({
  type: ["image/jpeg", "image/jpg", "image/png", "application/octet-stream"],
  limit: process.env.FACE_SEARCH_MAX_UPLOAD_BYTES || "8mb",
}), indexPhotoHandler);

app.post("/api/face/search", searchFaceHandler);
app.post("/api/face/consent", faceConsentHandler);
app.post("/api/face/backfill", backfillFaceHandler);
app.get("/api/face/test", testFaceHandler);

app.post("/api/photographers/profile-image", express.raw({
  type: ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/octet-stream"],
  limit: "15mb",
}), async (req, res) => {
  const authUser = await getAuthenticatedRequestUser(req);
  const imageKind = String(req.header("x-profile-image-kind") || "").trim();
  const fileName = decodeHeaderValue(req.header("x-file-name")) || "perfil.jpg";
  const contentType = String(req.header("content-type") || "application/octet-stream").toLowerCase();
  const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

  if (!authUser?.id) {
    return res.status(401).json({ error: "Entre novamente no painel para atualizar o perfil." });
  }

  if (!(await isVerifiedPhotographerUser(authUser.id))) {
    return res.status(403).json({ error: "Apenas fotografos aprovados podem atualizar foto e banner." });
  }

  if (imageKind !== "avatar" && imageKind !== "cover") {
    return res.status(400).json({ error: "Tipo de imagem de perfil invalido." });
  }

  if (!allowedTypes.has(contentType)) {
    return res.status(400).json({ error: "Formato invalido. Envie JPG, JPEG, PNG ou WEBP." });
  }

  if (fileBuffer.length === 0) {
    return res.status(400).json({ error: "Arquivo vazio ou nao enviado." });
  }

  const fileSizeLimit = imageKind === "avatar" ? 5 * 1024 * 1024 : 15 * 1024 * 1024;
  if (fileBuffer.length > fileSizeLimit) {
    return res.status(413).json({
      error: imageKind === "avatar"
        ? "Foto de perfil maior que 5 MB."
        : "Banner de capa maior que 15 MB.",
    });
  }

  try {
    const bucket = imageKind === "avatar" ? "photographer-avatars" : "photographer-covers";
    const folder = imageKind === "avatar" ? "avatars" : "covers";
    const safeName = fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || `${imageKind}.jpg`;
    const path = `${folder}/${authUser.id}/${Date.now()}-${safeName.replace(/\.[^.]+$/, "")}.jpg`;
    const uploaded = await uploadSupabaseProfileImage({
      bucket,
      path,
      contentType,
      fileBuffer,
      fileSizeLimit,
    });

    return res.json(uploaded);
  } catch (error: any) {
    console.error("Erro ao enviar imagem de perfil:", {
      photographerId: authUser.id,
      kind: imageKind,
      message: error?.message || String(error),
    });
    return res.status(500).json({
      error: "Nao foi possivel enviar a imagem. Verifique se o Supabase Storage esta habilitado e se SUPABASE_SERVICE_ROLE_KEY esta configurada na VPS.",
    });
  }
});

app.get("/api/products/engagement", async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 200);

  if (ids.length === 0 || !ids.every(isUuid)) {
    return res.status(400).json({ error: "IDs de midia invalidos." });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("product_likes")
      .select("productId")
      .in("productId", ids);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = 0;
    for (const row of data ?? []) {
      const productId = String((row as any).productId || "");
      if (productId) counts[productId] = (counts[productId] || 0) + 1;
    }

    return res.json({ counts });
  } catch (error: any) {
    if (/product_likes|does not exist|schema cache/i.test(String(error?.message || ""))) {
      return res.json({ counts: {} });
    }

    console.error("Erro ao consultar engajamento:", error);
    return res.status(500).json({ error: "Nao foi possivel consultar curtidas." });
  }
});

app.post("/api/products/:productId/favorite", async (req, res) => {
  const productId = String(req.params.productId || "");
  const visitorId = normalizeVisitorId(req.body?.visitorId);
  const liked = Boolean(req.body?.liked);

  if (!isUuid(productId) || !visitorId) {
    return res.status(400).json({ error: "Curtida invalida." });
  }

  try {
    if (liked) {
      const { error } = await getSupabaseAdmin()
        .from("product_likes")
        .upsert({ productId, visitorId }, { onConflict: "productId,visitorId" });
      if (error) throw error;
    } else {
      const { error } = await getSupabaseAdmin()
        .from("product_likes")
        .delete()
        .eq("productId", productId)
        .eq("visitorId", visitorId);
      if (error) throw error;
    }

    const { count, error: countError } = await getSupabaseAdmin()
      .from("product_likes")
      .select("productId", { count: "exact", head: true })
      .eq("productId", productId);

    if (countError) throw countError;
    return res.json({ productId, liked, count: count ?? 0 });
  } catch (error: any) {
    console.error("Erro ao atualizar curtida:", error);
    return res.status(500).json({ error: "Nao foi possivel atualizar a curtida." });
  }
});

app.post("/api/content-protection/log", async (req, res) => {
  const allowedTypes = new Set([
    "context_menu",
    "dragstart",
    "copy",
    "keyboard_devtools",
    "view_source",
    "devtools_open",
  ]);
  const type = String(req.body?.type || "").trim();
  const mediaId = String(req.body?.mediaId || "").trim();
  const pathValue = String(req.body?.path || "").trim().slice(0, 240);
  const eventName = String(req.body?.eventName || "").trim().slice(0, 160);
  const scope = String(req.body?.scope || "public-gallery").trim().slice(0, 80);
  const metadata = req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
    ? req.body.metadata
    : {};

  if (!allowedTypes.has(type)) {
    return res.status(400).json({ ok: false, error: "Tipo de tentativa invalido." });
  }

  const authUser = await getAuthenticatedRequestUser(req).catch(() => null);
  const ipHash = crypto
    .createHash("sha256")
    .update(getClientIp(req))
    .digest("hex");

  try {
    const { error } = await getSupabaseAdmin()
      .from("admin_activity_logs")
      .insert({
        actorId: authUser?.id ?? null,
        actorEmail: authUser?.email ?? null,
        action: `content_protection_${type}`,
        targetType: mediaId && isUuid(mediaId) ? "product" : "protected_media",
        targetId: mediaId && isUuid(mediaId) ? mediaId : null,
        metadata: {
          scope,
          path: pathValue,
          eventName: eventName || null,
          ipHash,
          origin: req.header("origin") || null,
          referer: req.header("referer") || null,
          userAgent: req.header("user-agent") || null,
          occurredAt: req.body?.occurredAt || new Date().toISOString(),
          ...metadata,
        },
        createdAt: new Date().toISOString(),
      });

    if (error) throw error;
    return res.json({ ok: true });
  } catch (error: any) {
    console.warn("Nao foi possivel registrar tentativa de protecao de conteudo:", {
      type,
      mediaId: mediaId || null,
      path: pathValue || null,
      error: error?.message || String(error),
    });
    return res.json({ ok: false });
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

    const { data: accessRows } = await getSupabaseAdmin()
      .from("download_access")
      .select("*")
      .eq("orderId", orderId)
      .eq("photoId", (item as any).productId)
      .eq("isActive", true)
      .limit(1);
    const access = accessRows?.[0];
    if (access?.expiresAt && new Date(access.expiresAt).getTime() <= Date.now()) {
      return res.status(403).json({ error: "O acesso temporario deste download expirou. Entre em contato com o suporte." });
    }

    if (!access) {
      const expiresAt = new Date(Date.now() + Number(process.env.DOWNLOAD_ACCESS_DAYS || 30) * 24 * 60 * 60 * 1000).toISOString();
      await getSupabaseAdmin()
        .from("download_access")
        .upsert({
          orderId,
          photoId: (item as any).productId,
          orderItemId: (item as any).id,
          userId: order.userId || null,
          customerEmail: order.buyerEmail,
          isActive: true,
          expiresAt,
        }, { onConflict: "orderId,photoId" });
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

    await getSupabaseAdmin()
      .from("downloads")
      .insert({
        orderId: (item as any).orderId,
        photoId: (item as any).productId,
        userId: order.userId,
      });

    const signedUrl = await createSignedMediaUrl((item as any).url || (product as any)?.storagePath || "", 300);
    return res.json({ url: signedUrl });
  } catch (error: any) {
    console.error("Erro ao autorizar download:", error);
    return res.status(500).json({ error: "Nao foi possivel autorizar o download." });
  }
});

// Photographer signup can require email confirmation, which may prevent the client from getting an auth session
// to insert into `public.photographers` (RLS). This endpoint registers a pending photographer record for admin approval.
app.post("/api/photographers/upload-log", async (req, res) => {
  const authUser = await getAuthenticatedRequestUser(req);
  if (!authUser) {
    return res.status(401).json({ error: "Sessao expirada. Entre novamente." });
  }

  const isPhotographer = await isVerifiedPhotographerUser(authUser.id);
  if (!isPhotographer) {
    return res.status(403).json({ error: "Apenas fotografos aprovados podem registrar auditoria de upload." });
  }

  const { action, productId, metadata } = req.body ?? {};
  if (action !== "upload_replace" && action !== "upload_copy") {
    return res.status(400).json({ error: "Acao de auditoria invalida." });
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("admin_activity_logs")
      .insert({
        actorId: authUser.id,
        actorEmail: authUser.email,
        action,
        targetType: "product",
        targetId: typeof productId === "string" && productId.trim() ? productId.trim() : null,
        metadata: typeof metadata === "object" && metadata !== null ? metadata : {},
        createdAt: new Date().toISOString(),
      });

    if (error) throw error;
    return res.json({ ok: true });
  } catch (error: any) {
    console.error("Erro ao registrar auditoria de upload:", error);
    return res.status(500).json({ error: "Nao foi possivel registrar auditoria de upload." });
  }
});

app.post("/api/photographers/request", async (req, res) => {
  let pool: pg.Pool | null = null;

  try {
    const { userId, email, name, instagram, bio, cpf, phone, avatar, referralCode } = req.body ?? {};
    devSignupLog("Cadastro iniciado", { email, hasUserId: Boolean(userId), hasReferralCode: Boolean(referralCode) });

    if (typeof email !== "string" || !email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email invalido." });
    }

    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: "Nome invalido." });
    }

    const normalizedInstagram = typeof instagram === "string"
      ? String(instagram).trim().replace(/^@+/, "").toLowerCase()
      : "";
    if (!normalizedInstagram || normalizedInstagram.length > 30 || !/^[a-z0-9._]+$/.test(normalizedInstagram)) {
      return res.status(400).json({ error: "Instagram valido e obrigatorio para cadastro de fotografo." });
    }

    const cpfDigits = onlyCpfDigits(typeof cpf === "string" ? cpf : "");
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return res.status(400).json({ error: "CPF valido e obrigatorio para cadastro de fotografo." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const phoneDigits = String(phone || "").replace(/\D/g, "").slice(0, 11);
    const resolvedId = typeof userId === "string" && userId.trim().length >= 8
      ? userId.trim()
      : `pending:${normalizedEmail}`;

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    const safeBio = typeof bio === "string" ? bio.slice(0, 1000) : "";
    const safeAvatar = typeof avatar === "string" ? avatar.slice(0, 2048) : "";
    const safeInstagram = `@${normalizedInstagram}`;

    await pool.query(
      `
        insert into public.photographers (
          id,
          auth_user_id,
          name,
          "displayName",
          username,
          slug,
          "isPublic",
          instagram,
          email,
          bio,
          avatar,
          phone,
          cpf,
          "referredByPhotographerId",
          verified,
          stats,
          "createdAt",
          "updatedAt"
        )
        values (
          $1,
          case when $1 like 'pending:%' then null else $1 end,
          $2,
          $2,
          left(regexp_replace(lower($3), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5($4), 1, 6), 80),
          left(regexp_replace(lower($3), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5($4), 1, 6), 80),
          false,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          null,
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
          id = excluded.id,
          name = excluded.name,
          auth_user_id = coalesce(excluded.auth_user_id, public.photographers.auth_user_id),
          "displayName" = excluded."displayName",
          username = excluded.username,
          slug = excluded.slug,
          "isPublic" = false,
          instagram = excluded.instagram,
          email = excluded.email,
          bio = excluded.bio,
          avatar = excluded.avatar,
          cpf = excluded.cpf,
          phone = excluded.phone,
          verified = false,
          approved = false,
          status = 'pending',
          "updatedAt" = now()
      `,
      [resolvedId, name.trim(), safeInstagram, normalizedEmail, safeBio, safeAvatar, phoneDigits, cpfDigits],
    );

    await pool.query("commit");
    devSignupLog("Photographer criado/atualizado como pending", { id: resolvedId, email: normalizedEmail });
    await registerPendingReferral({
      referralCode,
      referredPhotographerId: resolvedId,
      referredEmail: normalizedEmail,
      referredCpf: cpfDigits,
      referredPhone: phoneDigits,
      ipHash: crypto.createHash("sha256").update(getClientIp(req)).digest("hex"),
      userAgent: String(req.header("user-agent") || "").slice(0, 500),
    });
    devSignupLog("Referral registrada e aguardando aprovacao", { id: resolvedId, referralCode });
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
    const authUser = await getAuthenticatedRequestUser(req);

    if (typeof userId !== "string" || userId.trim().length < 8) {
      return res.status(400).json({ error: "userId invalido." });
    }

    if (typeof email !== "string" || !email.includes("@") || email.length > 256) {
      return res.status(400).json({ error: "Email invalido." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pendingId = `pending:${normalizedEmail}`;
    if (!authUser?.id || authUser.id !== userId.trim() || (authUser.email && authUser.email !== normalizedEmail)) {
      return res.status(403).json({ error: "Usuario autenticado nao corresponde ao cadastro reivindicado." });
    }
    devSignupLog("Email confirmado/login autenticado; claim iniciado", { userId: userId.trim(), email: normalizedEmail });

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    // If pending record exists, move it to the real auth uid. Keep verified/status/stats.
    const result = await pool.query(
      `
        with moved as (
          update public.photographers
          set
            id = $1,
            auth_user_id = $1,
            status = case when verified then 'active' else 'pending' end,
            approved = verified,
            "isPublic" = verified,
            "updatedAt" = now()
          where id = $2
          returning *
        )
        select count(*)::int as moved_count from moved
      `,
      [userId.trim(), pendingId],
    );

    await pool.query("commit");
    devSignupLog("Claim executado", { userId: userId.trim(), moved: result.rows?.[0]?.moved_count ?? 0 });
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
          and status in ('pending', 'failed', 'cancelled', 'canceled', 'refused')
        `,
        [paymentExternalId, orderId],
      );
      await recordPayment({
        orderId,
        provider: "infinitepay",
        providerPaymentId: paymentExternalId || eventId,
        method: "checkout",
        status: "paid",
        rawResponse: { ...payload, payment_check: paymentCheck },
      });
      await fulfillPaidOrder(orderId);
    } else if (["failed", "cancelled", "canceled", "refused", "refunded"].includes(status)) {
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
      await recordPayment({
        orderId,
        provider: "infinitepay",
        providerPaymentId: paymentExternalId || eventId,
        method: "checkout",
        status: status as any,
        rawResponse: { ...payload, payment_check: paymentCheck },
      });
    }
  } finally {
    await pool.end();
  }

  res.status(200).send("OK");
});

app.use((req, res, next) => {
  if (!shouldServeMaintenancePage({
    method: req.method,
    pathname: req.path,
  })) {
    next();
    return;
  }

  sendMaintenanceResponse(req, res);
});

app.get("/fotografo/:slug", (req, res, next) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug || slug === "definir-senha") {
    next();
    return;
  }

  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(301, `/${encodeURIComponent(slug)}${query}`);
});

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = ensureRequestId(req, res);
  const message = String(error?.message || "");
  const status = Number(error?.status || error?.statusCode || 500);
  const isCorsOriginError = message === "Origem nao permitida pelo CORS.";

  if (isCorsOriginError) {
    logEvent("warn", "cors_origin_rejected", {
      requestId,
      method: req.method,
      path: req.path,
      error: errorToLog(error),
    });
    res.status(403).json({ error: "Origem nao permitida pelo CORS.", requestId });
    return;
  }

  const isUploadBodyError = req.path === "/api/media/upload" &&
    (status === 413 || /request entity too large|payload too large|entity too large|too large/i.test(message));

  if (isUploadBodyError) {
    const limit = process.env.MEDIA_UPLOAD_LIMIT || "300mb";
    logEvent("warn", "upload_body_too_large", {
      requestId,
      method: req.method,
      path: req.path,
      limit,
      error: errorToLog(error),
    });
    res.status(413).json({
      error: `Arquivo maior que o limite aceito pelo backend (${limit}). Ajuste MEDIA_UPLOAD_LIMIT e o client_max_body_size do proxy/Nginx ativo ou envie um arquivo menor.`,
      requestId,
    });
    return;
  }

  if (req.path.startsWith("/api/")) {
    logEvent("error", "api_unhandled_error", {
      requestId,
      method: req.method,
      path: req.path,
      error: errorToLog(error),
    });
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "Erro interno da API.",
      requestId,
    });
    return;
  }

  next(error);
});

async function setupViteAndListen() {
  if (isLocalViteDevelopment) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : true,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", async (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      const eventSlug = getPublicEventSlug(req.path);
      const publicSlug = getRootPublicSlug(req.path);

      if (eventSlug) {
        try {
          const eventMeta = await getPublicEventMeta(eventSlug);
          if (eventMeta) {
            const html = await fs.readFile(indexPath, "utf8");
            const canonicalUrl = `${getRequestOrigin(req)}/evento/${eventMeta.slug}`;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(injectSeoMeta(html, {
              title: eventMeta.title,
              description: eventMeta.description,
              image: eventMeta.image,
              url: canonicalUrl,
              type: eventMeta.type,
            }));
            return;
          }
        } catch (error) {
          logEvent("warn", "event_seo_injection_failed", {
            slug: eventSlug,
            error: errorToLog(error),
          });
        }
      }

      if (publicSlug) {
        try {
          const photographerMeta = await getPublicPhotographerMeta(publicSlug);
          if (photographerMeta) {
            const html = await fs.readFile(indexPath, "utf8");
            const canonicalUrl = `${getRequestOrigin(req)}/${photographerMeta.slug}`;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(injectSeoMeta(html, {
              title: photographerMeta.title,
              description: photographerMeta.description,
              image: photographerMeta.image,
              url: canonicalUrl,
              type: "profile",
            }));
            return;
          }
        } catch (error) {
          logEvent("warn", "photographer_seo_injection_failed", {
            slug: publicSlug,
            error: errorToLog(error),
          });
        }
      }

      res.sendFile(indexPath);
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    startIntegrityScheduler();
  });

  server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 20 * 60 * 1000);
  server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 21 * 60 * 1000);
  server.keepAliveTimeout = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 65 * 1000);
}

if (!process.env.VERCEL) {
  setupViteAndListen();
}

export default app;
