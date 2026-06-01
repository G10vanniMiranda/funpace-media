import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const orderSearch = process.argv[2];
const reason = process.argv.slice(3).join(" ").trim() || "manual_confirmation";

if (!orderSearch) {
  console.error("Uso: node scripts/mark-order-paid.mjs <order-id-ou-prefixo> [motivo]");
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
  const client = await pool.connect();

  try {
    await client.query("begin");

    const orders = await client.query(
      `
        select *
        from public.orders
        where id::text = $1 or id::text ilike $2
        order by "createdAt" desc
        limit 2
        for update
      `,
      [orderSearch, `${orderSearch}%`],
    );

    if (orders.rowCount !== 1) {
      throw new Error(`Pedido nao encontrado ou prefixo ambiguo: ${orderSearch}`);
    }

    const order = orders.rows[0];
    const orderId = order.id;

    if (order.status !== "paid") {
      await client.query(
        `
          update public.orders
          set status = 'paid',
              "paymentExternalId" = coalesce("paymentExternalId", $2),
              "updatedAt" = now()
          where id = $1
        `,
        [orderId, `manual:${orderId}`],
      );
    }

    await client.query(
      `
        insert into public.payments ("orderId", provider, "providerPaymentId", method, status, "rawResponse", "updatedAt")
        values ($1, coalesce($2, 'manual'), $3, coalesce($4, 'pix'), 'paid', $5::jsonb, now())
        on conflict (provider, "providerPaymentId")
        do update set status = excluded.status,
                      "rawResponse" = excluded."rawResponse",
                      "updatedAt" = now()
      `,
      [
        orderId,
        order.paymentProvider || "manual",
        order.paymentExternalId || `manual:${orderId}`,
        order.paymentMethod || "pix",
        JSON.stringify({ source: "manual_confirmation", reason }),
      ],
    );

    await client.query(
      `
        update public.payments
        set status = 'paid',
            "updatedAt" = now()
        where "orderId" = $1
      `,
      [orderId],
    );

    await client.query(
      `
        insert into public.payment_events (provider, "eventId", "orderId", status, payload)
        values (coalesce($2, 'manual'), $3, $1, 'paid', $4::jsonb)
        on conflict (provider, "eventId")
        do update set status = excluded.status,
                      payload = excluded.payload
      `,
      [
        orderId,
        order.paymentProvider || "manual",
        `manual:${orderId}`,
        JSON.stringify({ source: "manual_confirmation", reason }),
      ],
    );

    const items = await client.query(
      `select * from public.order_items where "orderId" = $1 order by "createdAt" asc`,
      [orderId],
    );
    if (items.rowCount === 0) {
      throw new Error("Pedido pago nao possui itens; nao ha download para liberar.");
    }

    const expiresAt = new Date(Date.now() + Number(process.env.DOWNLOAD_ACCESS_DAYS || 30) * 24 * 60 * 60 * 1000);
    for (const item of items.rows) {
      await client.query(
        `
          insert into public.download_access ("orderId", "photoId", "orderItemId", "userId", "customerEmail", "isActive", "expiresAt")
          values ($1, $2, $3, $4, $5, true, $6)
          on conflict ("orderId", "photoId")
          do update set "orderItemId" = excluded."orderItemId",
                        "userId" = excluded."userId",
                        "customerEmail" = excluded."customerEmail",
                        "isActive" = true,
                        "expiresAt" = excluded."expiresAt",
                        "updatedAt" = now()
        `,
        [orderId, item.productId, item.id, order.userId || null, order.buyerEmail, expiresAt],
      );
    }

    const settings = await client.query(
      `select "platformFeePercent" from public.platform_settings where id = 'default' limit 1`,
    );
    const feePercent = Number(settings.rows[0]?.platformFeePercent ?? 30);

    for (const item of items.rows) {
      const grossAmount = Number(item.price || 0);
      const platformFee = Number((grossAmount * feePercent / 100).toFixed(2));
      const netAmount = Number(Math.max(0, grossAmount - platformFee).toFixed(2));
      await client.query(
        `
          insert into public.photographer_transactions (
            "photographerId", "orderId", "orderItemId", "grossAmount", "platformFee", "netAmount", status
          )
          values ($1, $2, $3, $4, $5, $6, 'pending')
          on conflict ("orderItemId") do nothing
        `,
        [item.vendedorId, orderId, item.id, grossAmount, platformFee, netAmount],
      );

      await client.query(
        `
          update public.products
          set "salesCount" = coalesce("salesCount", 0) + 1
          where id = $1
        `,
        [item.productId],
      );
    }

    await client.query("commit");

    console.log(`Pedido liberado: ${orderId}`);
    console.log(`Itens liberados: ${items.rowCount}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
