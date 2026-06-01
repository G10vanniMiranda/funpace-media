import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const search = process.argv[2];
if (!search) {
  console.error("Uso: node scripts/inspect-order-payment.mjs <order-id-ou-prefixo>");
  process.exit(1);
}

function dbConfigFromEnv() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:
          process.env.DB_HOST ||
          process.env.PGHOST ||
          (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
        database: process.env.DATABASE || process.env.PGDATABASE || "postgres",
        user: process.env.DB_USER || process.env.PGUSER || "postgres",
        password:
          process.env.DB_PASSWORD ||
          process.env.POSTGRES_PASSWORD ||
          process.env.PGPASSWORD ||
          process.env.POSTGRES ||
          process.env.RAILS_MASTER_KEY,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };
}

function mask(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.includes("@")) {
    const [local, domain] = text.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return text.length > 12 ? `${text.slice(0, 8)}...` : text;
}

async function main() {
  const config = dbConfigFromEnv();
  if (config.host && /[a-z]/i.test(config.host)) {
    try {
      const lookup = await dns.promises.lookup(config.host, { family: 4 });
      if (lookup?.address) config.host = lookup.address;
    } catch {
      // Let pg report connection errors.
    }
  }

  const pool = new pg.Pool(config);
  const orderResult = await pool.query(
    `
      select *
      from public.orders
      where id::text = $1 or id::text ilike $2
      order by "createdAt" desc
      limit 5
    `,
    [search, `${search}%`],
  );

  console.log("\n## pedidos");
  console.table(orderResult.rows.map((row) => ({
    id: row.id,
    status: row.status,
    total: row.total,
    buyerName: row.buyerName,
    buyerEmail: mask(row.buyerEmail),
    paymentMethod: row.paymentMethod,
    paymentProvider: row.paymentProvider,
    paymentExternalId: row.paymentExternalId,
    checkoutUrl: mask(row.checkoutUrl),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })));

  for (const order of orderResult.rows) {
    const orderId = order.id;

    const items = await pool.query(
      `select id, "productId", name, type, price, "vendedorId", event, checkpoint, "thumbnailUrl", "createdAt"
       from public.order_items
       where "orderId" = $1
       order by "createdAt" asc`,
      [orderId],
    );
    console.log(`\n## itens ${orderId}`);
    console.table(items.rows);

    const payments = await pool.query(
      `select id, provider, "providerPaymentId", method, status, "createdAt", "updatedAt", "rawResponse"
       from public.payments
       where "orderId" = $1
       order by "createdAt" desc`,
      [orderId],
    );
    console.log(`\n## payments ${orderId}`);
    console.table(payments.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerPaymentId: row.providerPaymentId,
      method: row.method,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      rawKeys: row.rawResponse ? Object.keys(row.rawResponse).join(",") : "",
    })));

    const events = await pool.query(
      `select id, provider, "eventId", status, "createdAt", payload
       from public.payment_events
       where "orderId" = $1
       order by "createdAt" desc
       limit 10`,
      [orderId],
    );
    console.log(`\n## payment_events ${orderId}`);
    console.table(events.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      eventId: row.eventId,
      status: row.status,
      createdAt: row.createdAt,
      payloadKeys: row.payload ? Object.keys(row.payload).join(",") : "",
    })));

    const access = await pool.query(
      `select id, "photoId", "orderItemId", "customerEmail", "isActive", "expiresAt", "createdAt"
       from public.download_access
       where "orderId" = $1
       order by "createdAt" desc`,
      [orderId],
    );
    console.log(`\n## download_access ${orderId}`);
    console.table(access.rows.map((row) => ({ ...row, customerEmail: mask(row.customerEmail) })));

    const transactions = await pool.query(
      `select id, "photographerId", "orderItemId", "grossAmount", "platformFee", "netAmount", status, "createdAt"
       from public.photographer_transactions
       where "orderId" = $1
       order by "createdAt" desc`,
      [orderId],
    );
    console.log(`\n## photographer_transactions ${orderId}`);
    console.table(transactions.rows);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
