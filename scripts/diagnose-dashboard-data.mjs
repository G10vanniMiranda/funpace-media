import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

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
  return `${text.slice(0, 8)}...`;
}

async function main() {
  const config = dbConfigFromEnv();
  if (config.host && /[a-z]/i.test(config.host)) {
    try {
      const lookup = await dns.promises.lookup(config.host, { family: 4 });
      if (lookup?.address) config.host = lookup.address;
    } catch {
      // Let pg report the actual connection failure.
    }
  }

  const pool = new pg.Pool(config);

  async function query(name, sql) {
    try {
      const result = await pool.query(sql);
      console.log(`\n## ${name}`);
      console.table(result.rows);
    } catch (error) {
      console.log(`\n## ${name}`);
      console.log("ERRO:", error.message);
    }
  }

  await query(
    "tabelas principais",
    `
      select 'products' as tabela, count(*)::int as total from public.products
      union all select 'orders', count(*)::int from public.orders
      union all select 'order_items', count(*)::int from public.order_items
      union all select 'photographer_transactions', count(*)::int from public.photographer_transactions
      union all select 'photographers', count(*)::int from public.photographers
      union all select 'payments', count(*)::int from public.payments
      union all select 'withdrawal_requests', count(*)::int from public.withdrawal_requests
    `,
  );

  await query(
    "produtos por status",
    `
      select coalesce(status, 'published') as status, count(*)::int as total
      from public.products
      group by 1
      order by 2 desc
    `,
  );

  await query(
    "produtos publicados por fotografo",
    `
      select
        p."vendedorId",
        left(coalesce(f.email, ''), 2) || '***' as fotografo,
        count(*)::int as total,
        count(*) filter (where p.type = 'IMG')::int as fotos,
        count(*) filter (where p.type in ('VIDEO', 'VIEW'))::int as videos
      from public.products p
      left join public.photographers f on f.id = p."vendedorId"
      where coalesce(p.status, 'published') = 'published'
      group by 1, 2
      order by total desc
      limit 10
    `,
  );

  await query(
    "fotografos cadastrados",
    `
      select
        f.id,
        left(coalesce(f.email, ''), 2) || '***' as email,
        f.verified,
        f.role,
        count(p.*) filter (where coalesce(p.status, 'published') = 'published')::int as produtos_publicados,
        count(p.*) filter (where coalesce(p.status, 'published') = 'removed')::int as produtos_removidos
      from public.photographers f
      left join public.products p on p."vendedorId" = f.id
      group by f.id, f.email, f.verified, f.role
      order by produtos_publicados desc, email asc
    `,
  );

  await query(
    "pedidos por status",
    `
      select status, count(*)::int as total, coalesce(sum(total), 0)::numeric(12,2) as valor
      from public.orders
      group by status
      order by total desc
    `,
  );

  await query(
    "itens por status do pedido",
    `
      select
        o.status,
        count(oi.*)::int as itens,
        coalesce(sum(oi.price), 0)::numeric(12,2) as valor
      from public.order_items oi
      left join public.orders o on o.id = oi."orderId"
      group by o.status
      order by itens desc
    `,
  );

  await query(
    "transacoes por status",
    `
      select
        status,
        count(*)::int as total,
        coalesce(sum("grossAmount"), 0)::numeric(12,2) as bruto,
        coalesce(sum("netAmount"), 0)::numeric(12,2) as liquido
      from public.photographer_transactions
      group by status
      order by total desc
    `,
  );

  await query(
    "transacoes por fotografo",
    `
      select
        pt."photographerId",
        left(coalesce(f.email, ''), 2) || '***' as fotografo,
        pt.status,
        count(*)::int as total,
        coalesce(sum(pt."grossAmount"), 0)::numeric(12,2) as bruto,
        coalesce(sum(pt."netAmount"), 0)::numeric(12,2) as liquido
      from public.photographer_transactions pt
      left join public.photographers f on f.id = pt."photographerId"
      group by pt."photographerId", f.email, pt.status
      order by total desc
    `,
  );

  await query(
    "usuarios auth com papel",
    `
      select
        id,
        left(coalesce(email, ''), 2) || '***' as email,
        raw_app_meta_data ->> 'role' as role,
        created_at,
        last_sign_in_at
      from auth.users
      where raw_app_meta_data ? 'role'
      order by created_at desc
      limit 20
    `,
  );

  await query(
    "vinculo auth x fotografo",
    `
      select
        u.id as auth_id,
        left(coalesce(u.email, ''), 2) || '***' as auth_email,
        f.id as photographer_id,
        left(coalesce(f.email, ''), 2) || '***' as photographer_email,
        f.verified,
        count(p.*) filter (where coalesce(p.status, 'published') = 'published')::int as produtos_publicados
      from auth.users u
      left join public.photographers f on lower(f.email) = lower(u.email)
      left join public.products p on p."vendedorId" = f.id
      group by u.id, u.email, f.id, f.email, f.verified
      order by produtos_publicados desc, u.created_at desc
      limit 20
    `,
  );

  await query(
    "politicas rls principais",
    `
      select schemaname, tablename, policyname, roles, cmd
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'products',
          'orders',
          'order_items',
          'photographer_transactions',
          'withdrawal_requests',
          'photographers',
          'platform_settings'
        )
      order by tablename, policyname
    `,
  );

  await query(
    "pedidos pagos sem itens",
    `
      select count(*)::int as pedidos_pagos_sem_itens
      from public.orders o
      where o.status = 'paid'
        and not exists (
          select 1 from public.order_items oi where oi."orderId" = o.id
        )
    `,
  );

  await query(
    "itens pagos sem transacao",
    `
      select count(*)::int as itens_pagos_sem_transacao, coalesce(sum(oi.price), 0)::numeric(12,2) as valor
      from public.order_items oi
      join public.orders o on o.id = oi."orderId"
      where o.status = 'paid'
        and not exists (
          select 1 from public.photographer_transactions pt where pt."orderItemId" = oi.id
        )
    `,
  );

  const latestOrders = await pool.query(`
    select id, status, total, "paymentProvider", "buyerEmail", "createdAt", "updatedAt"
    from public.orders
    order by "createdAt" desc
    limit 8
  `);
  console.log("\n## ultimos pedidos");
  console.table(
    latestOrders.rows.map((row) => ({
      ...row,
      id: mask(row.id),
      buyerEmail: mask(row.buyerEmail),
    })),
  );

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
