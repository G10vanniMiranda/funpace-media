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

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DATABASE || "postgres",
        user: process.env.DB_USER || process.env.USER || "postgres",
        password: process.env.POSTGRES || process.env.RAILS_MASTER_KEY,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };
}

const mediaBucket = process.env.SUPABASE_BUCKET || process.env.BUCKET || "funpace-media";

function getSupabaseApiConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase Storage nao configurado para assinar URLs. Defina SUPABASE_SERVICE_ROLE_KEY no .env do servidor.");
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

function getSupabaseStorageUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}

function extractStoragePathFromUrl(value: string) {
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");

  try {
    const parsed = new URL(value);
    const publicMarker = `/storage/v1/object/public/${mediaBucket}/`;
    const signedMarker = `/storage/v1/object/sign/${mediaBucket}/`;
    const marker = parsed.pathname.includes(publicMarker) ? publicMarker : signedMarker;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return "";
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

async function createSignedMediaUrl(rawPathOrUrl: string, expiresIn = 900) {
  const path = extractStoragePathFromUrl(rawPathOrUrl);
  if (!path) throw new Error("Caminho de midia invalido.");

  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${mediaBucket}/${encodeURI(path)}`,
    {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao assinar midia.");
  }

  const payload: any = await response.json().catch(() => ({}));
  const signedPath = payload?.signedURL || payload?.signedUrl || payload?.url || "";
  if (!signedPath) throw new Error("Supabase nao retornou URL assinada.");
  if (signedPath.startsWith("http")) return signedPath;
  if (signedPath.startsWith("/storage/v1/")) return `${supabaseUrl}${signedPath}`;
  return `${supabaseUrl}/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`;
}

function createPublicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;

  const supabaseUrl = getSupabaseStorageUrl();
  const path = extractStoragePathFromUrl(rawPathOrUrl);
  if (!supabaseUrl || !path) return rawPathOrUrl;

  return `${supabaseUrl}/storage/v1/object/public/${mediaBucket}/${encodeURI(path)}`;
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

function mapPaymentStatus(status: unknown) {
  const normalized = String(status || "").toLowerCase();
  if (["paid", "approved", "completed", "confirmed"].includes(normalized)) return "paid";
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

app.post("/api/checkout/create-session", async (req, res) => {
  let pool: pg.Pool | null = null;
  let orderId = "";

  try {
    const { items, successUrl, userId, buyer } = req.body;

    if (!buyer?.cpf || !isValidCpf(buyer.cpf)) {
      return res.status(400).json({ error: "CPF valido e obrigatorio para pagamento." });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: "Dados do comprador incompletos." });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio." });
    }

    const productIds = [...new Set(items.map((item: any) => item.id))];
    if (!productIds.every(isUuid)) {
      return res.status(400).json({ error: "Carrinho contem produto invalido." });
    }

    pool = new Pool(getDbConfig());
    await pool.query("begin");

    const productsResult = await pool.query(
      `
        select
          id,
          name,
          price,
          url,
          type,
          "vendedorId",
          bib,
          event,
          checkpoint,
          "thumbnailUrl"
        from public.products
        where id = any($1::uuid[])
          and status = 'published'
      `,
      [productIds],
    );

    if (productsResult.rowCount !== productIds.length) {
      await pool.query("rollback");
      return res.status(400).json({ error: "Um ou mais produtos nao estao disponiveis." });
    }

    const products = productsResult.rows;
    const total = products.reduce((sum: number, product: any) => sum + Number(product.price), 0);
    const buyerCpf = onlyCpfDigits(buyer.cpf);

    if (total <= 1) {
      await pool.query("rollback");
      return res.status(400).json({
        error: "A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.",
      });
    }

    const orderResult = await pool.query(
      `
        insert into public.orders (
          "userId",
          "buyerName",
          "buyerEmail",
          "buyerPhone",
          "buyerCpf",
          total,
          status,
          "paymentProvider"
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', 'infinitepay')
        returning id
      `,
      [
        userId && userId !== "guest" ? userId : null,
        String(buyer.fullName).trim(),
        String(buyer.email).trim().toLowerCase(),
        String((buyer as any).phone || "nao_informado").trim(),
        buyerCpf,
        total,
      ],
    );

    orderId = orderResult.rows[0].id;

    for (const product of products) {
      await pool.query(
        `
          insert into public.order_items (
            "orderId",
            "productId",
            name,
            type,
            price,
            url,
            "vendedorId",
            bib,
            event,
            checkpoint,
            "thumbnailUrl"
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          orderId,
          product.id,
          product.name,
          product.type,
          product.price,
          product.url,
          product.vendedorId,
          product.bib,
          product.event,
          product.checkpoint,
          product.thumbnailUrl,
        ],
      );
    }

    const handle = process.env.INFINITEPAY_HANDLE;

    if (!handle) {
      await pool.query("rollback");
      return res.status(500).json({ error: "INFINITEPAY_HANDLE nao configurado." });
    }

    const fallbackSuccessUrl = getRequestOrigin(req);
    const successRedirect = new URL(successUrl || fallbackSuccessUrl);
    successRedirect.searchParams.set("payment", "success");
    successRedirect.searchParams.set("order", orderId);

    const phoneDigits = typeof buyer.phone === "string" ? String(buyer.phone).replace(/\D/g, "") : "";
    const phoneE164 = phoneDigits.length >= 10 ? `+55${phoneDigits}` : "";

    // InfinitePay Checkout API (official) - create a proper checkout link with items in cents.
    const checkoutPayload: any = {
      handle,
      order_nsu: orderId,
      redirect_url: successRedirect.toString(),
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
      await pool.query("rollback");
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
      await pool.query("rollback");
      return res.status(502).json({ error: "Resposta invalida da InfinitePay ao criar link." });
    }

    await pool.query(
      `update public.orders set "checkoutUrl" = $1 where id = $2`,
      [checkoutUrlWithOrder, orderId],
    );

    await pool.query("commit");

    res.json({ url: checkoutUrlWithOrder, orderId, total });
  } catch (error: any) {
    if (pool) {
      try {
        await pool.query("rollback");
      } catch {
        // Ignore rollback errors after connection failures.
      }
    }

    console.error("Erro ao criar checkout:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (pool) await pool.end();
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
  const captureMethod = getConfirmationValue(["capture_method", "captureMethod", "payment_method", "paymentMethod"]);
  const paymentReturn = getConfirmationValue(["payment"]);

  if (!handle) {
    return res.status(500).json({ error: "INFINITEPAY_HANDLE nao configurado." });
  }

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: "Pedido invalido." });
  }

  const pool = new Pool(getDbConfig());

  try {
    const existingOrder = await pool.query(
      `select id, status, "paymentExternalId" from public.orders where id = $1 limit 1`,
      [orderId],
    );
    const order = existingOrder.rows[0];

    if (!order) {
      return res.status(404).json({ error: "Pedido nao encontrado." });
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

    const confirmedByCheckoutReturn = !paid &&
      paymentReturn === "success" &&
      Boolean(captureMethod || transactionNsu);

    if (!paid && !confirmedByCheckoutReturn) {
      return res.status(409).json({
        paid: false,
        message: "Pagamento ainda nao confirmado.",
        source: "checkout-confirm",
        reason: !transactionNsu && !captureMethod && !slug ? "missing_confirmation_params" : "payment_check_unpaid",
        paymentCheckError,
      });
    }

    await pool.query(
      `
        update public.orders
        set status = 'paid', "paymentExternalId" = coalesce($1, "paymentExternalId")
        where id = $2
          and status in ('pending', 'failed', 'cancelled')
      `,
      [transactionNsu, orderId],
    );

    return res.json({ paid: true, confirmedBy: paid ? "payment_check" : "checkout_return" });
  } finally {
    await pool.end();
  }
});

app.post("/api/media/sign", async (req, res) => {
  const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : [];
  const uniquePaths = Array.from(new Set(paths)).filter(Boolean).slice(0, 200);

  if (uniquePaths.length === 0) {
    return res.json({ urls: {} });
  }

  const pool = new Pool(getDbConfig());

  try {
    const productsResult = await pool.query(
      `
        select url, "thumbnailUrl"
        from public.products
        where url = any($1::text[])
          or "thumbnailUrl" = any($1::text[])
      `,
      [uniquePaths],
    );
    const allowedPaths = new Set<string>();

    for (const product of productsResult.rows) {
      if (product.thumbnailUrl) {
        allowedPaths.add(String(product.thumbnailUrl));
      } else if (product.url) {
        allowedPaths.add(String(product.url));
      }
    }

    const signablePaths = uniquePaths.filter((path) => allowedPaths.has(path));
    if (signablePaths.length === 0) {
      return res.json({ urls: {} });
    }

    const hasSigningKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY);
    const entries = hasSigningKey
      ? await Promise.all(
          signablePaths.map(async (path) => [path, await createSignedMediaUrl(path, 900)] as const),
        )
      : signablePaths.map((path) => [path, createPublicMediaUrl(path)] as const);

    if (!hasSigningKey) {
      console.warn("SUPABASE_SERVICE_ROLE_KEY ausente. /api/media/sign retornou URLs publicas; downloads protegidos exigem a service role key.");
    }

    return res.json({ urls: Object.fromEntries(entries) });
  } catch (error: any) {
    console.error("Erro ao assinar midias:", error);
    return res.status(500).json({ error: error?.message || "Nao foi possivel assinar midias." });
  } finally {
    await pool.end();
  }
});

app.post("/api/downloads/record", async (req, res) => {
  const orderId = String(req.body?.orderId || "");
  const orderItemId = String(req.body?.orderItemId || "");

  if (!isUuid(orderId) || !isUuid(orderItemId)) {
    return res.status(400).json({ error: "Download invalido." });
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

  if (!isUuid(orderId) || !isUuid(orderItemId)) {
    return res.status(400).json({ error: "Download invalido." });
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
          oi.name,
          oi.type,
          oi.url,
          p."storagePath",
          o."buyerEmail",
          o."userId",
          o.status
        from public.order_items oi
        join public.orders o on o.id = oi."orderId"
        left join public.products p on p.id = oi."productId"
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

    const signedUrl = await createSignedMediaUrl(item.storagePath || item.url, 300);
    return res.json({ url: signedUrl });
  } catch (error: any) {
    console.error("Erro ao autorizar download:", error);
    return res.status(500).json({ error: "Nao foi possivel autorizar o download." });
  } finally {
    await pool.end();
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
  const signatureHeader = getWebhookSignature(req);

  if (getWebhookSecret() && signatureHeader && !isValidWebhookSignature(req)) {
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

  const status = paymentCheck?.paid ? "paid" : mapPaymentStatus(payload?.status);
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
