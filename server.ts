import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import pg from "pg";
import { isValidCpf, onlyCpfDigits } from "./src/lib/cpf";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const { Pool } = pg;

app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));

function getDbConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
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
  return payload?.order ||
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
      payload?.transaction_id ||
      payload?.transactionId ||
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
    const totalAmount = Math.round(total * 100);
    const buyerCpf = onlyCpfDigits(buyer.cpf);

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

    const fallbackSuccessUrl = `${req.protocol}://${req.get("host")}`;
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
      items: products.map((product: any) => ({
        quantity: 1,
        price: Math.round(Number(product.price) * 100),
        description: String(product.name || "Produto").slice(0, 120),
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

    const checkoutResponse = await fetch("https://api.checkout.infinitepay.io/links", {
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
  const status = mapPaymentStatus(payload?.status);
  const eventId = getWebhookEventId(payload, orderId, status);
  const paymentExternalId = payload?.transaction_id || payload?.transactionId || payload?.id || null;

  if (!getWebhookSecret()) {
    return res.status(500).json({ error: "INFINITEPAY_WEBHOOK_SECRET nao configurado." });
  }

  if (!isValidWebhookSignature(req)) {
    return res.status(401).json({ error: "Assinatura do webhook invalida." });
  }

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
      [eventId, isUuid(orderId) ? orderId : null, status, JSON.stringify(payload)],
    );

    if (eventResult.rowCount === 0) {
      return res.status(200).send("OK");
    }

    if (isUuid(orderId)) {
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
    }
  } finally {
    await pool.end();
  }

  res.status(200).send("OK");
});

async function setupVite() {
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

setupVite();
