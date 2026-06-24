import dotenv from 'dotenv';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const reasonArg = process.argv.find((arg) => arg.startsWith('--reason='));
const reason = reasonArg?.slice('--reason='.length).trim() || 'cancel_pending_orders_cleanup';

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

async function createPool() {
  const config = dbConfigFromEnv();
  if (config.host && /[a-z]/i.test(config.host)) {
    try {
      const lookup = await dns.promises.lookup(config.host, { family: 4 });
      if (lookup?.address) config.host = lookup.address;
    } catch {
      // Let pg report connection errors.
    }
  }
  return new pg.Pool(config);
}

async function findCancelablePendingOrders(client) {
  return client.query(`
    with paid_signals as (
      select distinct "orderId"
      from public.payments
      where status = 'paid'
      union
      select distinct "orderId"
      from public.payment_events
      where status = 'paid'
    ),
    item_counts as (
      select "orderId", count(*)::int as item_count
      from public.order_items
      group by "orderId"
    )
    select o.id,
           o.status,
           o.total,
           o."buyerName",
           o."buyerEmail",
           o."paymentMethod",
           o."paymentProvider",
           o."paymentExternalId",
           o."createdAt",
           coalesce(ic.item_count, 0) as item_count
    from public.orders o
    left join paid_signals ps on ps."orderId" = o.id
    left join item_counts ic on ic."orderId" = o.id
    where o.status = 'pending'
      and o."paymentProvider" = 'infinitepay'
      and ps."orderId" is null
    order by o."createdAt" asc
    for update
  `);
}

function maskEmail(value) {
  const text = String(value || '');
  if (!text.includes('@')) return text;
  const [local, domain] = text.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  const pool = await createPool();
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await findCancelablePendingOrders(client);
    const orders = result.rows;

    console.log(`Pedidos pending cancelaveis: ${orders.length}`);
    console.table(orders.map((order) => ({
      id: String(order.id).slice(0, 8),
      total: Number(order.total || 0),
      buyerName: order.buyerName,
      buyerEmail: maskEmail(order.buyerEmail),
      method: order.paymentMethod,
      items: order.item_count,
      createdAt: order.createdAt,
    })));

    if (!apply) {
      await client.query('rollback');
      console.log('Dry-run: nenhuma alteracao aplicada. Use --apply para cancelar.');
      return;
    }

    for (const order of orders) {
      await client.query(
        `
          update public.orders
          set status = 'canceled',
              "updatedAt" = now()
          where id = $1
            and status = 'pending'
        `,
        [order.id],
      );

      await client.query(
        `
          update public.payments
          set status = 'canceled',
              "updatedAt" = now()
          where "orderId" = $1
            and status <> 'paid'
        `,
        [order.id],
      );

      await client.query(
        `
          insert into public.payment_events (provider, "eventId", "orderId", status, payload)
          values ('infinitepay', $2, $1, 'canceled', $3::jsonb)
          on conflict (provider, "eventId")
          do update set status = excluded.status,
                        payload = excluded.payload
        `,
        [
          order.id,
          `${order.id}:manual-cancel-pending`,
          JSON.stringify({
            source: 'cancel-pending-orders',
            reason,
            canceledAt: new Date().toISOString(),
          }),
        ],
      );

      await client.query(
        `
          insert into public.admin_activity_logs (action, "targetType", "targetId", metadata)
          values ('order_pending_cancelled_cli', 'order', $1, $2::jsonb)
        `,
        [order.id, JSON.stringify({ source: 'cancel-pending-orders', reason })],
      );
    }

    await client.query('commit');
    console.log(`Pedidos cancelados: ${orders.length}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
