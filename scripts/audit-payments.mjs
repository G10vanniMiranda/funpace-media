import dotenv from 'dotenv';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const reportJson = args.has('--json');
const orderArg = process.argv.find((arg) => arg.startsWith('--order='));
const reasonArg = process.argv.find((arg) => arg.startsWith('--reason='));
const actionArg = process.argv.find((arg) => arg.startsWith('--action='));
const action = actionArg?.split('=')[1] || 'audit';
const orderSearch = orderArg?.split('=')[1] || '';
const reason = reasonArg?.slice('--reason='.length) || '';

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

function maskEmail(value) {
  const text = String(value || '');
  if (!text.includes('@')) return text;
  const [local, domain] = text.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
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

async function audit(pool) {
  const result = await pool.query(`
    with item_counts as (
      select "orderId", count(*)::int as item_count
      from public.order_items
      group by "orderId"
    ),
    active_access_counts as (
      select "orderId", count(*)::int as access_count
      from public.download_access
      where "isActive" = true
      group by "orderId"
    ),
    payment_rollup as (
      select "orderId",
             array_agg(status order by "updatedAt" desc nulls last, "createdAt" desc) as payment_statuses,
             bool_or(status = 'paid') as has_paid_payment,
             count(*)::int as payment_count
      from public.payments
      group by "orderId"
    ),
    event_rollup as (
      select "orderId",
             array_agg(status order by "createdAt" desc) filter (where status is not null) as event_statuses,
             bool_or(status = 'paid') as has_paid_event,
             count(*)::int as event_count
      from public.payment_events
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
           coalesce(ic.item_count, 0) as item_count,
           coalesce(aac.access_count, 0) as access_count,
           coalesce(pr.payment_count, 0) as payment_count,
           coalesce(er.event_count, 0) as event_count,
           coalesce(pr.payment_statuses, '{}') as payment_statuses,
           coalesce(er.event_statuses, '{}') as event_statuses,
           coalesce(pr.has_paid_payment, false) as has_paid_payment,
           coalesce(er.has_paid_event, false) as has_paid_event
    from public.orders o
    left join item_counts ic on ic."orderId" = o.id
    left join active_access_counts aac on aac."orderId" = o.id
    left join payment_rollup pr on pr."orderId" = o.id
    left join event_rollup er on er."orderId" = o.id
    where o."paymentProvider" = 'infinitepay'
    order by o."createdAt" desc
  `);

  const issues = result.rows.map((row) => {
    const reasons = [];
    const missingAccessCount = Math.max(0, Number(row.item_count || 0) - Number(row.access_count || 0));
    if (row.status !== 'paid' && row.has_paid_payment) reasons.push('payment_paid_order_not_paid');
    if (row.status !== 'paid' && row.has_paid_event) reasons.push('webhook_paid_order_not_paid');
    if (row.status === 'paid' && missingAccessCount > 0) reasons.push('paid_order_missing_download_access');
    if (row.status === 'pending' && row.payment_count > 0 && row.event_count === 0) reasons.push('pending_without_webhook');
    if (row.status === 'pending' && !row.paymentExternalId) reasons.push('missing_provider_identifiers');
    return {
      id: row.id,
      status: row.status,
      total: Number(row.total),
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      paymentMethod: row.paymentMethod,
      paymentExternalId: row.paymentExternalId,
      createdAt: row.createdAt,
      itemCount: Number(row.item_count || 0),
      accessCount: Number(row.access_count || 0),
      missingAccessCount,
      paymentStatuses: row.payment_statuses,
      eventStatuses: row.event_statuses,
      reasons,
    };
  }).filter((row) => row.reasons.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalInfinitePayOrders: result.rows.length,
      issueCount: issues.length,
      pendingWithoutWebhook: issues.filter((row) => row.reasons.includes('pending_without_webhook')).length,
      missingProviderIdentifiers: issues.filter((row) => row.reasons.includes('missing_provider_identifiers')).length,
      paidMissingAccess: issues.filter((row) => row.reasons.includes('paid_order_missing_download_access')).length,
      paidSignalNotReleased: issues.filter((row) => row.reasons.includes('payment_paid_order_not_paid') || row.reasons.includes('webhook_paid_order_not_paid')).length,
    },
    issues,
  };
}

async function findOrderForUpdate(client, search) {
  const result = await client.query(
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

  if (result.rowCount !== 1) {
    throw new Error(`Pedido nao encontrado ou prefixo ambiguo: ${search}`);
  }

  return result.rows[0];
}

async function manualRelease(pool, search, releaseReason) {
  if (!apply) throw new Error('Use --apply para alterar registros.');
  if (!releaseReason || releaseReason.length < 8) throw new Error('Use --reason=<comprovante/motivo> para liberacao manual.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await findOrderForUpdate(client, search);
    const orderId = order.id;

    const items = await client.query(
      `select * from public.order_items where "orderId" = $1 order by "createdAt" asc`,
      [orderId],
    );
    if (items.rowCount === 0) throw new Error('Pedido sem itens; nao ha downloads para liberar.');

    const providerPaymentId = order.paymentExternalId || `manual:${orderId}`;
    await client.query(
      `
        update public.orders
        set status = 'paid',
            "paymentExternalId" = coalesce("paymentExternalId", $2),
            "updatedAt" = now()
        where id = $1
      `,
      [orderId, providerPaymentId],
    );

    await client.query(
      `
        insert into public.payments ("orderId", provider, "providerPaymentId", method, status, "rawResponse", "updatedAt")
        values ($1, 'infinitepay', $2, coalesce($3, 'checkout'), 'paid', $4::jsonb, now())
        on conflict (provider, "providerPaymentId")
        do update set status = 'paid',
                      "rawResponse" = excluded."rawResponse",
                      "updatedAt" = now()
      `,
      [
        orderId,
        providerPaymentId,
        order.paymentMethod,
        JSON.stringify({ source: 'audit-payments', action: 'manual_release', reason: releaseReason }),
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
        values ('infinitepay', $2, $1, 'paid', $3::jsonb)
        on conflict (provider, "eventId")
        do update set status = excluded.status,
                      payload = excluded.payload
      `,
      [
        orderId,
        `${orderId}:manual-release`,
        JSON.stringify({ source: 'audit-payments', action: 'manual_release', reason: releaseReason }),
      ],
    );

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
      const inserted = await client.query(
        `
          insert into public.photographer_transactions (
            "photographerId", "orderId", "orderItemId", "grossAmount", "platformFee", "netAmount", status
          )
          values ($1, $2, $3, $4, $5, $6, 'pending')
          on conflict ("orderItemId") do nothing
          returning id
        `,
        [item.vendedorId, orderId, item.id, grossAmount, platformFee, netAmount],
      );

      if (inserted.rowCount > 0) {
        await client.query(
          `update public.products set "salesCount" = coalesce("salesCount", 0) + 1 where id = $1`,
          [item.productId],
        );
      }
    }

    await client.query(
      `
        insert into public.admin_activity_logs (action, "targetType", "targetId", metadata)
        values ('payment_manual_release_cli', 'order', $1, $2::jsonb)
      `,
      [orderId, JSON.stringify({ source: 'audit-payments', reason: releaseReason })],
    );

    await client.query('commit');
    return { orderId, releasedItems: items.rowCount };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function fulfillPaidOrder(client, order) {
  const orderId = order.id;
  const items = await client.query(
    `select * from public.order_items where "orderId" = $1 order by "createdAt" asc`,
    [orderId],
  );
  if (items.rowCount === 0) return { orderId, releasedItems: 0, transactionsCreated: 0 };

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
  let transactionsCreated = 0;

  for (const item of items.rows) {
    const grossAmount = Number(item.price || 0);
    const platformFee = Number((grossAmount * feePercent / 100).toFixed(2));
    const netAmount = Number(Math.max(0, grossAmount - platformFee).toFixed(2));
    const inserted = await client.query(
      `
        insert into public.photographer_transactions (
          "photographerId", "orderId", "orderItemId", "grossAmount", "platformFee", "netAmount", status
        )
        values ($1, $2, $3, $4, $5, $6, 'pending')
        on conflict ("orderItemId") do nothing
        returning id
      `,
      [item.vendedorId, orderId, item.id, grossAmount, platformFee, netAmount],
    );

    if (inserted.rowCount > 0) {
      transactionsCreated += 1;
      await client.query(
        `update public.products set "salesCount" = coalesce("salesCount", 0) + 1 where id = $1`,
        [item.productId],
      );
    }
  }

  return { orderId, releasedItems: items.rowCount, transactionsCreated };
}

async function fulfillPaidMissing(pool) {
  if (!apply) throw new Error('Use --apply para alterar registros.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const orders = await client.query(`
      with item_counts as (
        select "orderId", count(*)::int as item_count
        from public.order_items
        group by "orderId"
      ),
      active_access_counts as (
        select "orderId", count(*)::int as access_count
        from public.download_access
        where "isActive" = true
        group by "orderId"
      )
      select o.*
      from public.orders o
      join item_counts ic on ic."orderId" = o.id
      left join active_access_counts aac on aac."orderId" = o.id
      where o.status = 'paid'
        and o."paymentProvider" = 'infinitepay'
        and coalesce(aac.access_count, 0) < ic.item_count
      order by o."createdAt" asc
      for update
    `);

    const results = [];
    for (const order of orders.rows) {
      results.push(await fulfillPaidOrder(client, order));
      await client.query(
        `
          insert into public.admin_activity_logs (action, "targetType", "targetId", metadata)
          values ('payment_fulfillment_retry_cli', 'order', $1, $2::jsonb)
        `,
        [order.id, JSON.stringify({ source: 'audit-payments', reason: 'paid_order_missing_download_access' })],
      );
    }

    await client.query('commit');
    return results;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function printReport(report) {
  console.log('\n## resumo');
  console.table([report.summary]);

  console.log('\n## inconsistencias');
  console.table(report.issues.map((row) => ({
    id: row.id.slice(0, 8),
    status: row.status,
    total: row.total,
    buyerName: row.buyerName,
    buyerEmail: maskEmail(row.buyerEmail),
    method: row.paymentMethod,
    items: row.itemCount,
    access: row.accessCount,
    reasons: row.reasons.join(','),
    createdAt: row.createdAt,
  })));
}

async function main() {
  const pool = await createPool();
  try {
    if (action === 'manual-release') {
      const result = await manualRelease(pool, orderSearch, reason);
      console.log(`Pedido liberado: ${result.orderId}`);
      console.log(`Itens liberados: ${result.releasedItems}`);
      return;
    }

    if (action === 'fulfill-paid-missing') {
      const results = await fulfillPaidMissing(pool);
      console.log(`Pedidos pagos corrigidos: ${results.length}`);
      console.table(results.map((result) => ({
        id: result.orderId.slice(0, 8),
        releasedItems: result.releasedItems,
        transactionsCreated: result.transactionsCreated,
      })));
      return;
    }

    const report = await audit(pool);
    if (reportJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
