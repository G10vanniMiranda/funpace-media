import dotenv from 'dotenv';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const search = process.argv[2];
const reason = process.argv.slice(3).join(' ').trim() || 'Reversao manual para pending';

if (!search) {
  console.error('Uso: node scripts/revert-order-to-pending.mjs <order-id-ou-prefixo> <motivo>');
  process.exit(1);
}

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
    await client.query('begin');

    const orders = await client.query(
      `
        select *
        from public.orders
        where id::text = $1 or id::text ilike $2
        order by "createdAt" desc
        limit 2
        for update
      `,
      [search, `${search}%`],
    );

    if (orders.rowCount !== 1) {
      throw new Error(`Pedido nao encontrado ou prefixo ambiguo: ${search}`);
    }

    const order = orders.rows[0];
    const orderId = order.id;

    const access = await client.query(
      `delete from public.download_access where "orderId" = $1`,
      [orderId],
    );

    const transactions = await client.query(
      `
        update public.photographer_transactions
        set status = 'cancelled'
        where "orderId" = $1 and status <> 'cancelled'
        returning "orderItemId"
      `,
      [orderId],
    );

    if (transactions.rowCount > 0) {
      await client.query(
        `
          update public.products p
          set "salesCount" = greatest(0, coalesce(p."salesCount", 0) - 1)
          from public.order_items oi
          where oi."productId" = p.id
            and oi."orderId" = $1
            and oi.id = any($2::uuid[])
        `,
        [orderId, transactions.rows.map((row) => row.orderItemId)],
      );
    }

    await client.query(
      `
        update public.orders
        set status = 'pending',
            "paymentExternalId" = null,
            "paidEmailSentAt" = null,
            "updatedAt" = now()
        where id = $1
      `,
      [orderId],
    );

    await client.query(
      `
        update public.payments
        set status = 'pending',
            "updatedAt" = now(),
            "rawResponse" = coalesce("rawResponse", '{}'::jsonb) || $2::jsonb
        where "orderId" = $1
      `,
      [orderId, JSON.stringify({ reversal: { source: 'revert-order-to-pending', reason, reversedAt: new Date().toISOString() } })],
    );

    await client.query(
      `
        update public.payment_events
        set status = 'pending',
            payload = coalesce(payload, '{}'::jsonb) || $2::jsonb
        where "orderId" = $1
          and status = 'paid'
          and payload->>'source' in ('audit-payments', 'admin_payment_recovery')
      `,
      [orderId, JSON.stringify({ reversal: { source: 'revert-order-to-pending', reason, reversedAt: new Date().toISOString() } })],
    );

    await client.query(
      `
        insert into public.payment_events (provider, "eventId", "orderId", status, payload)
        values ('infinitepay', $2, $1, 'pending', $3::jsonb)
        on conflict (provider, "eventId")
        do update set status = excluded.status,
                      payload = excluded.payload
      `,
      [
        orderId,
        `${orderId}:manual-reversal-to-pending`,
        JSON.stringify({ source: 'revert-order-to-pending', reason }),
      ],
    );

    await client.query(
      `
        insert into public.admin_activity_logs (action, "targetType", "targetId", metadata)
        values ('payment_manual_release_reverted_cli', 'order', $1, $2::jsonb)
      `,
      [orderId, JSON.stringify({ source: 'revert-order-to-pending', reason })],
    );

    await client.query('commit');

    console.log(`Pedido revertido para pending: ${orderId}`);
    console.log(`Downloads removidos: ${access.rowCount}`);
    console.log(`Transacoes canceladas: ${transactions.rowCount}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
