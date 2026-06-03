import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const watchedTables = [
  'orders',
  'order_items',
  'download_access',
  'download_events',
  'products',
  'payments',
  'payment_events',
  'admin_activity_logs',
  'customers',
  'photographers',
];

async function tableExists(name) {
  const result = await client.query(
    `select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1
    ) as exists`,
    [name],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columns(name) {
  const result = await client.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`,
    [name],
  );
  return result.rows.map((row) => row.column_name);
}

async function count(name) {
  const result = await client.query(`select count(*)::int as count from public.${quoteIdent(name)}`);
  return result.rows[0]?.count ?? 0;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function runSafe(label, sql) {
  try {
    const result = await client.query(sql);
    return { label, rows: result.rows };
  } catch (error) {
    return { label, error: error.message };
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL nao configurada.');
  }

  await client.connect();

  const schema = {};
  for (const table of watchedTables) {
    if (await tableExists(table)) {
      schema[table] = {
        count: await count(table),
        columns: await columns(table),
      };
    }
  }

  const findings = [];

  findings.push(await runSafe('storage_buckets', `
    select id, name, public, file_size_limit, allowed_mime_types
    from storage.buckets
    order by name;
  `));

  findings.push(await runSafe('rls_policies_sensiveis', `
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and tablename in ('orders', 'order_items', 'download_access', 'download_events', 'products', 'payments', 'payment_events', 'objects')
    order by schemaname, tablename, policyname;
  `));

  findings.push(await runSafe('download_access_sem_pedido_pago', `
    select
      da.id,
      da."orderId",
      da."photoId",
      da."orderItemId",
      da."customerEmail",
      da."createdAt",
      da."isActive",
      o.status as order_status,
      o."buyerEmail",
      oi.id as order_item_id
    from public.download_access da
    left join public.orders o on o.id = da."orderId"
    left join public.order_items oi on oi.id = da."orderItemId"
    where o.id is null or o.status <> 'paid' or oi.id is null
    order by da."createdAt" desc
    limit 100;
  `));

  findings.push(await runSafe('download_events_sem_pedido_pago', `
    select
      de.id,
      de."orderId",
      de."productId",
      de."orderItemId",
      de."buyerEmail",
      de."createdAt",
      de."ipHash",
      de."userAgent",
      o.status as order_status,
      o."buyerEmail",
      oi.id as order_item_id
    from public.download_events de
    left join public.orders o on o.id = de."orderId"
    left join public.order_items oi on oi.id = de."orderItemId"
    where o.id is null or o.status <> 'paid' or oi.id is null
    order by de."createdAt" desc
    limit 100;
  `));

  findings.push(await runSafe('produtos_baixados_por_emails_diferentes_do_comprador', `
    select
      de."productId",
      oi.name,
      oi.event,
      o.id as order_id,
      o."buyerEmail",
      de."buyerEmail" as download_email,
      count(*)::int as downloads,
      max(de."createdAt") as last_download
    from public.download_events de
    join public.orders o on o.id = de."orderId"
    join public.order_items oi on oi.id = de."orderItemId"
    where o.status = 'paid'
      and lower(coalesce(de."buyerEmail", '')) <> lower(coalesce(o."buyerEmail", ''))
    group by de."productId", oi.name, oi.event, o.id, o."buyerEmail", de."buyerEmail"
    order by last_download desc
    limit 100;
  `));

  findings.push(await runSafe('downloads_recentes_por_ip', `
    select
      coalesce(de."ipHash", 'sem_ip_hash') as ip_hash,
      count(*)::int as downloads,
      count(distinct de."orderId")::int as orders,
      count(distinct de."productId")::int as products,
      min(de."createdAt") as first_seen,
      max(de."createdAt") as last_seen
    from public.download_events de
    where de."createdAt" >= now() - interval '30 days'
    group by coalesce(de."ipHash", 'sem_ip_hash')
    order by downloads desc
    limit 50;
  `));

  findings.push(await runSafe('pedidos_pagos_sem_download_access', `
    select
      o.id,
      o."buyerName",
      o."buyerEmail",
      o.total,
      o."createdAt",
      count(oi.id)::int as items,
      count(da.id)::int as access_rows
    from public.orders o
    join public.order_items oi on oi."orderId" = o.id
    left join public.download_access da on da."orderId" = o.id and da."orderItemId" = oi.id
    where o.status = 'paid'
    group by o.id, o."buyerName", o."buyerEmail", o.total, o."createdAt"
    having count(da.id) < count(oi.id)
    order by o."createdAt" desc
    limit 100;
  `));

  findings.push(await runSafe('admin_logs_recentes', `
    select id, action, "targetType", "targetId", "actorEmail", "createdAt", metadata
    from public.admin_activity_logs
    order by "createdAt" desc
    limit 100;
  `));

  findings.push(await runSafe('produtos_recentes', `
    select id, name, event, bib, status, "vendedorId", "createdAt", "updatedAt", url, "thumbnailUrl"
    from public.products
    order by "createdAt" desc
    limit 50;
  `));

  findings.push(await runSafe('pedidos_pagos_recentes', `
    select o.id, o."buyerName", o."buyerEmail", o.status, o.total, o."createdAt",
      string_agg(oi.name || ' / ' || coalesce(oi.event, ''), ' | ') as items
    from public.orders o
    left join public.order_items oi on oi."orderId" = o.id
    where o.status = 'paid'
    group by o.id, o."buyerName", o."buyerEmail", o.status, o.total, o."createdAt"
    order by o."createdAt" desc
    limit 100;
  `));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    schema,
    findings,
  }, null, 2));

  await client.end();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  try {
    await client.end();
  } catch {
    // ignore close errors
  }
  process.exit(1);
});
