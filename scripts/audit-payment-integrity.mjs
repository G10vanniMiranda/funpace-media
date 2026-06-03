import dotenv from 'dotenv';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

function dbConfigFromEnv() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:
          process.env.DB_HOST ||
          process.env.PGHOST ||
          (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
        database: process.env.DATABASE || process.env.PGDATABASE || 'postgres',
        user: process.env.DB_USER || process.env.PGUSER || 'postgres',
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

async function countRows(client, label, query) {
  const result = await client.query(query);
  return { label, count: Number(result.rows[0]?.count || 0) };
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
  try {
    const checks = await Promise.all([
      countRows(pool, 'paid_orders_without_download_access', `
        select count(*)::int
        from public.orders o
        join public.order_items oi on oi."orderId" = o.id
        left join public.download_access da on da."orderId" = o.id and da."orderItemId" = oi.id and da."isActive" = true
        where o.status = 'paid' and da.id is null
      `),
      countRows(pool, 'paid_payments_with_pending_order', `
        select count(distinct p."orderId")::int
        from public.payments p
        join public.orders o on o.id = p."orderId"
        where p.status = 'paid' and o.status <> 'paid'
      `),
      countRows(pool, 'download_access_without_valid_paid_order', `
        select count(*)::int
        from public.download_access da
        left join public.orders o on o.id = da."orderId"
        left join public.order_items oi on oi.id = da."orderItemId"
        where o.id is null or o.status <> 'paid' or oi.id is null
      `),
      countRows(pool, 'orders_without_payment_external_id', `
        select count(*)::int
        from public.orders
        where "paymentProvider" = 'infinitepay' and "paymentExternalId" is null
      `),
      countRows(pool, 'payments_without_order', `
        select count(*)::int
        from public.payments p
        left join public.orders o on o.id = p."orderId"
        where o.id is null
      `),
      countRows(pool, 'payment_events_paid_order_not_paid', `
        select count(distinct e."orderId")::int
        from public.payment_events e
        join public.orders o on o.id = e."orderId"
        where e.status = 'paid' and o.status <> 'paid'
      `),
    ]);

    console.table(checks);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
