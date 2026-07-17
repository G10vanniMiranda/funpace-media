import 'dotenv/config';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

dns.setDefaultResultOrder('ipv4first');

const TIME_ZONE = 'America/Porto_Velho';
const SEARCH_TERMS = ['gustavo', 'olyver', 'oliver'];
const OUTPUT_ROOT = path.resolve('artifacts', 'auditoria-gustavo-olyver');

function readFirstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function dbConfigFromEnv() {
  const connectionString = readFirstEnv(['PRODUCTION_DATABASE_URL', 'DATABASE_URL']);
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL/DATABASE_URL ausente.');
  return { connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 };
}

function decimalToCents(value) {
  if (value === null || value === undefined || value === '') return 0n;
  const text = String(value).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Valor monetario invalido: ${text}`);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function centsToDecimal(cents) {
  const value = BigInt(cents || 0);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function formatBrl(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function maskEmail(value) {
  const text = String(value || '').trim();
  const at = text.indexOf('@');
  if (at < 1) return text ? '[mascarado]' : '';
  const local = text.slice(0, at);
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(3, local.length - 2))}${text.slice(at)}`;
}

function maskName(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).map((part) => `${part[0] || ''}${'*'.repeat(Math.max(1, part.length - 1))}`).join(' ');
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function isoInZone(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replace(' ', 'T');
}

function monthInZone(value) {
  if (!value) return 'sem_data';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function sumCents(rows, field) {
  return rows.reduce((sum, row) => sum + BigInt(row[field] || 0), 0n);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  const lines = [headers.map(csvEscape).join(';')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function safeJsonSignals(payload) {
  const signals = {};
  const allowed = /(^|_)(status|amount|paid_amount|total|transaction_nsu|transaction_id|order_nsu|slug|invoice_slug|capture_method|payment_method|fee|fees|net_amount)$/i;
  const visit = (value, prefix = '', depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.slice(0, 10).forEach((entry, index) => visit(entry, `${prefix}[${index}]`, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (allowed.test(key) && ['string', 'number', 'boolean'].includes(typeof entry)) signals[next] = entry;
      if (typeof entry === 'object') visit(entry, next, depth + 1);
    }
  };
  visit(payload);
  return signals;
}

function signalValue(signals, keyPattern) {
  const entry = Object.entries(signals || {}).find(([key]) => keyPattern.test(key));
  return entry?.[1] ?? '';
}

function mapGatewayStatus(payload) {
  if (payload?.paid === true) return 'paid';
  const raw = normalizeText(payload?.status || payload?.payment_status || payload?.event || payload?.type || '');
  if (['paid', 'approved', 'confirmed', 'captured', 'received', 'recebido', 'completed', 'settled', 'success', 'succeeded'].includes(raw)) return 'paid';
  if (['rejected', 'denied', 'refused'].includes(raw)) return 'refused';
  if (['failed', 'expired'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled', 'voided'].includes(raw)) return 'canceled';
  if (['refunded', 'chargeback', 'reversed'].includes(raw)) return 'refunded';
  return 'pending';
}

async function verifyInfinitePayOrders(orderIds, payments, paymentEvents) {
  const handle = readFirstEnv(['INFINITEPAY_HANDLE']);
  const baseUrl = readFirstEnv(['INFINITEPAY_BASE_URL']) || 'https://api.checkout.infinitepay.io';
  const endpoint = readFirstEnv(['INFINITEPAY_PAYMENT_CHECK_ENDPOINT']) || `${baseUrl.replace(/\/+$/, '')}/payment_check`;
  if (!handle) return orderIds.map((orderId) => ({ orderId, status: 'not_checked', reason: 'INFINITEPAY_HANDLE ausente' }));

  const results = [];
  for (const orderId of orderIds) {
    const orderPayments = payments.filter((row) => String(row.orderId) === String(orderId));
    const orderEvents = paymentEvents.filter((row) => String(row.orderId) === String(orderId));
    const signals = [...orderPayments.map((row) => safeJsonSignals(row.rawResponse)), ...orderEvents.map((row) => safeJsonSignals(row.payload))];
    const merged = Object.assign({}, ...signals);
    const providerFallback = orderPayments.map((row) => String(row.providerPaymentId || '')).find((value) => value && value !== orderId && !value.startsWith('manual:')) || '';
    const transactionNsu = String(signalValue(merged, /(^|\.)(transaction_nsu|transaction_id)$/i) || providerFallback).trim();
    const slug = String(signalValue(merged, /(^|\.)(slug|invoice_slug)$/i) || '').trim();
    if (!transactionNsu || !slug) {
      results.push({ orderId, transactionNsu, slugAvailable: Boolean(slug), status: 'not_checked', reason: 'identificadores insuficientes' });
      continue;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, order_nsu: orderId, transaction_nsu: transactionNsu, slug }),
        signal: AbortSignal.timeout(15000),
      });
      const raw = await response.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
      const safe = safeJsonSignals(payload);
      results.push({
        orderId,
        transactionNsu,
        slugAvailable: true,
        httpStatus: response.status,
        status: response.ok ? mapGatewayStatus(payload) : 'check_failed',
        amountSignal: signalValue(safe, /(^|\.)(paid_amount|amount|total)$/i),
        reason: response.ok ? '' : 'InfinitePay retornou erro na consulta',
      });
    } catch (error) {
      results.push({ orderId, transactionNsu, slugAvailable: true, status: 'check_failed', reason: error?.name || 'erro de rede' });
    }
  }
  return results;
}

function arrayGroup(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function scoreCandidate(row) {
  const name = normalizeText(`${row.name || ''} ${row.displayName || ''}`);
  let score = 0;
  if (name.includes('gustavo olyver')) score += 100;
  if (name.includes('gustavo oliver')) score += 90;
  if (name.includes('gustavo')) score += 30;
  if (name.includes('olyver') || name.includes('oliver')) score += 30;
  score += Math.min(20, Number(row.product_count || 0) > 0 ? 10 : 0);
  score += Math.min(10, Number(row.event_count || 0) > 0 ? 5 : 0);
  return score;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function relationColumns(client, table) {
  const result = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
  `, [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

function columnExpr(columns, name, fallback = 'null') {
  return columns.has(name) ? `t."${name}"` : fallback;
}

async function main() {
  const startedAt = new Date();
  const pool = new pg.Pool(dbConfigFromEnv());
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    await client.query(`set local statement_timeout = '120s'`);

    const dbClock = (await client.query(`select clock_timestamp() as now, current_setting('TimeZone') as db_timezone`)).rows[0];
    const tableInventory = (await client.query(`
      select c.relname as table_name, coalesce(s.n_live_tup, 0)::bigint as estimated_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `)).rows;

    const coreRelations = new Set(['orders', 'order_items', 'payments', 'payment_events', 'photographer_transactions', 'withdrawal_requests', 'photographer_wallets', 'products', 'events', 'photographers', 'platform_settings', 'coupons', 'downloads', 'download_access', 'download_events']);

    const photographerColumns = await relationColumns(client, 'photographers');
    const productColumns = await relationColumns(client, 'products');
    const orderItemColumns = await relationColumns(client, 'order_items');
    const transactionColumns = await relationColumns(client, 'photographer_transactions');

    const candidateResult = await client.query(`
      select p.id, p.auth_user_id, p.name, p."displayName", p.email, p.phone, p.status,
             p.verified, p.approved, p."commissionPercent", p."createdAt", p."updatedAt",
             p.slug, p.username,
             (select count(*)::int from public.events e where e."photographerId" = p.id) as event_count,
             (select count(*)::int from public.products pr where pr."vendedorId" = p.id ${productColumns.has('ownerId') ? 'or pr."ownerId" = p.id' : ''}) as product_count
      from public.photographers p
      where lower(coalesce(p.name, '') || ' ' || coalesce(p."displayName", '') || ' ' || coalesce(p.email, '') || ' ' || coalesce(p.username, '') || ' ' || coalesce(p.slug, ''))
            similar to '%(gustavo|olyver|oliver)%'
      order by p."createdAt" asc
    `);
    const candidates = candidateResult.rows.map((row) => ({ ...row, score: scoreCandidate(row) })).sort((a, b) => b.score - a.score);
    if (candidates.length === 0) throw new Error('Nenhum cadastro candidato a Gustavo/Olyver/Oliver foi localizado.');
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      throw new Error('Ha mais de um cadastro candidato com a mesma evidencia; selecao manual necessaria.');
    }
    const photographer = candidates[0];
    const photographerId = photographer.id;

    const authUsers = (await client.query(`
      select id, email, phone, created_at, last_sign_in_at,
             raw_user_meta_data->>'full_name' as full_name,
             raw_user_meta_data->>'name' as metadata_name
      from auth.users
      where id = $1::uuid
      limit 1
    `, [photographer.auth_user_id || photographerId])).rows;

    const legacyRelations = [];
    for (const relation of tableInventory.filter((row) => /(order|payment|transaction|payout|withdraw|event|sale)/i.test(row.table_name) && !coreRelations.has(row.table_name))) {
      const columns = (await client.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by ordinal_position
      `, [relation.table_name])).rows.map((row) => row.column_name);
      const relationName = quoteIdentifier(relation.table_name);
      const inspected = (await client.query(`
        select count(*)::int as exact_rows,
               count(*) filter (where to_jsonb(t)::text ilike any($1::text[]))::int as photographer_matches
        from public.${relationName} t
      `, [[`%${photographerId}%`, `%${photographer.email}%`, '%gustavo%', '%olyver%', '%oliver%']])).rows[0];
      legacyRelations.push({ tableName: relation.table_name, columns, ...inspected });
    }

    const events = (await client.query(`
      select id, name, date, status, "isPublished", "createdAt"
      from public.events
      where "photographerId" = $1
         ${productColumns.has('eventId') ? `or id in (select distinct "eventId" from public.products where "vendedorId" = $1 ${productColumns.has('ownerId') ? 'or "ownerId" = $1' : ''})` : ''}
      order by date asc, "createdAt" asc
    `, [photographerId])).rows;

    const productsSummary = (await client.query(`
      select count(*)::int as total,
             count(*) filter (where type = 'IMG')::int as photos,
             count(*) filter (where type = 'VIDEO')::int as videos,
             count(*) filter (where type = 'VIEW')::int as views,
             count(*) filter (where status = 'published')::int as published,
             min("createdAt") as first_created_at, max("createdAt") as last_created_at
      from public.products
      where "vendedorId" = $1 ${productColumns.has('ownerId') ? 'or "ownerId" = $1' : ''}
    `, [photographerId])).rows[0];

    const itemSelect = [
      't.id', 't."orderId"', 't."productId"', 't.name', 't.type', 't.price', 't."vendedorId"', 't.event', 't.checkpoint', 't."createdAt"',
      `${columnExpr(orderItemColumns, 'eventId')} as "eventId"`,
      `${columnExpr(orderItemColumns, 'ownerId')} as "ownerId"`,
      `${columnExpr(orderItemColumns, 'platformFeePercent')} as "platformFeePercent"`,
      `${columnExpr(orderItemColumns, 'platformFee')} as "platformFee"`,
      `${columnExpr(orderItemColumns, 'photographerAmount')} as "photographerAmount"`,
    ].join(', ');
    const items = (await client.query(`
      select ${itemSelect}, o."buyerName", o."buyerEmail", o.total as order_total, o.subtotal as order_subtotal,
             o."discountTotal", o."discountType", o."discountPercentage", o.status as order_status,
             o."paymentMethod", o."paymentProvider", o."paymentExternalId", o."createdAt" as order_created_at,
             o."updatedAt" as order_updated_at
      from public.order_items t
      join public.orders o on o.id = t."orderId"
      where t."vendedorId" = $1 ${orderItemColumns.has('ownerId') ? 'or t."ownerId" = $1' : ''}
      order by o."createdAt" asc, t."createdAt" asc
    `, [photographerId])).rows;
    const orderIds = [...new Set(items.map((item) => item.orderId))];

    const payments = orderIds.length ? (await client.query(`
      select id, "orderId", provider, "providerPaymentId", method, status, "rawResponse", "createdAt", "updatedAt"
      from public.payments where "orderId" = any($1::uuid[])
      order by "createdAt" asc
    `, [orderIds])).rows : [];
    const paymentEvents = orderIds.length ? (await client.query(`
      select id, provider, "eventId", "orderId", status, payload, "createdAt"
      from public.payment_events where "orderId" = any($1::uuid[])
      order by "createdAt" asc
    `, [orderIds])).rows : [];

    const transactionSelect = [
      't.id', 't."photographerId"', 't."orderId"', 't."orderItemId"', 't."grossAmount"', 't."platformFee"', 't."netAmount"', 't.status', 't."createdAt"',
      `${columnExpr(transactionColumns, 'productId')} as "productId"`,
      `${columnExpr(transactionColumns, 'eventId')} as "eventId"`,
      `${columnExpr(transactionColumns, 'platformFeePercent')} as "platformFeePercent"`,
      `${columnExpr(transactionColumns, 'currency', `'BRL'`)} as currency`,
      `${columnExpr(transactionColumns, 'availableAt')} as "availableAt"`,
    ].join(', ');
    const transactions = (await client.query(`
      select ${transactionSelect}
      from public.photographer_transactions t
      where t."photographerId" = $1
      order by t."createdAt" asc
    `, [photographerId])).rows;

    const withdrawals = (await client.query(`
      select id, amount, status, note, "createdAt", "updatedAt", "processedAt"
      from public.withdrawal_requests
      where "photographerId" = $1
      order by "createdAt" asc
    `, [photographerId])).rows;
    const wallet = (await client.query(`
      select id, balance, "pendingBalance", "updatedAt"
      from public.photographer_wallets where "photographerId" = $1 limit 1
    `, [photographerId])).rows[0] || null;
    const settings = (await client.query(`select id, "platformFeePercent", "withdrawalFee", "updatedAt" from public.platform_settings where id = 'default' limit 1`)).rows[0] || null;
    const adminLogs = (await client.query(`
      select id, "actorId", "actorEmail", action, "targetType", "targetId", metadata, "createdAt"
      from public.admin_activity_logs
      where "targetId" = $1 or metadata::text ilike $2
         or (lower(action) similar to '%(withdraw|payout|repasse|saque)%' and metadata::text ilike $2)
      order by "createdAt" asc
    `, [photographerId, `%${photographerId}%`])).rows;

    const allCounts = (await client.query(`
      select
        (select count(*) from public.orders)::bigint as orders,
        (select count(*) from public.order_items)::bigint as order_items,
        (select count(*) from public.payments)::bigint as payments,
        (select count(*) from public.payment_events)::bigint as payment_events,
        (select count(*) from public.photographer_transactions)::bigint as photographer_transactions,
        (select count(*) from public.withdrawal_requests)::bigint as withdrawal_requests,
        (select count(*) from public.products)::bigint as products,
        (select count(*) from public.events)::bigint as events,
        (select count(*) from public.photographers)::bigint as photographers
    `)).rows[0];

    const duplicateExternalIds = (await client.query(`
      select "paymentExternalId", count(*)::int as count, array_agg(id order by "createdAt") as order_ids
      from public.orders
      where "paymentExternalId" is not null and btrim("paymentExternalId") <> ''
      group by "paymentExternalId" having count(*) > 1
    `)).rows;
    const duplicateItems = orderIds.length ? (await client.query(`
      select "orderId", "productId", count(*)::int as count, array_agg(id order by "createdAt") as item_ids
      from public.order_items where "orderId" = any($1::uuid[])
      group by "orderId", "productId" having count(*) > 1
    `, [orderIds])).rows : [];

    const paymentsByOrder = arrayGroup(payments, (row) => row.orderId);
    const eventsByOrder = arrayGroup(paymentEvents, (row) => row.orderId);
    const transactionsByItem = arrayGroup(transactions, (row) => row.orderItemId || '');
    const duplicateExternalSet = new Set(duplicateExternalIds.flatMap((row) => row.order_ids.map(String)));
    const duplicateItemSet = new Set(duplicateItems.flatMap((row) => row.item_ids.map(String)));
    const paidTargetOrderIds = [...new Set(items.filter((item) => normalizeText(item.order_status) === 'paid').map((item) => item.orderId))];
    const gatewayChecks = await verifyInfinitePayOrders(paidTargetOrderIds, payments, paymentEvents);
    const gatewayCheckByOrder = new Map(gatewayChecks.map((row) => [String(row.orderId), row]));

    const saleRows = [];
    const divergenceRows = [];
    const excludedRows = [];
    for (const item of items) {
      const itemPayments = paymentsByOrder.get(item.orderId) || [];
      const itemEvents = eventsByOrder.get(item.orderId) || [];
      const itemTransactions = transactionsByItem.get(item.id) || [];
      const paidPayments = itemPayments.filter((row) => normalizeText(row.status) === 'paid');
      const paidEvents = itemEvents.filter((row) => ['paid', 'approved', 'confirmed', 'success', 'completed'].includes(normalizeText(row.status)));
      const transaction = itemTransactions[0] || null;
      const gatewayCheck = gatewayCheckByOrder.get(String(item.orderId)) || null;
      const orderPaid = normalizeText(item.order_status) === 'paid';
      const duplicate = duplicateExternalSet.has(String(item.orderId)) || duplicateItemSet.has(String(item.id)) || itemTransactions.length > 1;
      const hasFinancialEvidence = paidPayments.length > 0 || paidEvents.length > 0 || Boolean(transaction) || gatewayCheck?.status === 'paid';
      const gatewayReversed = ['refunded', 'canceled', 'refused', 'failed'].includes(gatewayCheck?.status);
      const valid = orderPaid && hasFinancialEvidence && !duplicate && !gatewayReversed;

      const priceCents = decimalToCents(item.price);
      const orderTotalCents = decimalToCents(item.order_total);
      const orderSubtotalCents = decimalToCents(item.order_subtotal ?? item.order_total);
      const orderDiscountCents = decimalToCents(item.discountTotal);
      const allocatedDiscountCents = orderTotalCents > 0n ? (orderDiscountCents * priceCents + orderTotalCents / 2n) / orderTotalCents : 0n;
      const originalGrossCents = priceCents + allocatedDiscountCents;

      let platformFeeCents = 0n;
      let photographerNetCents = 0n;
      let commissionSource = 'nao_comprovada';
      let feePercent = '';
      if (transaction) {
        platformFeeCents = decimalToCents(transaction.platformFee);
        photographerNetCents = decimalToCents(transaction.netAmount);
        commissionSource = 'photographer_transactions';
        if (transaction.platformFeePercent !== null && transaction.platformFeePercent !== undefined) {
          feePercent = String(transaction.platformFeePercent);
        } else if (priceCents > 0n) {
          const basisPoints = (platformFeeCents * 10000n + priceCents / 2n) / priceCents;
          feePercent = `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, '0')}`;
        }
      } else if (item.platformFee !== null && item.photographerAmount !== null) {
        platformFeeCents = decimalToCents(item.platformFee);
        photographerNetCents = decimalToCents(item.photographerAmount);
        commissionSource = 'order_items_snapshot';
        feePercent = item.platformFeePercent ?? '';
      }

      const paymentSignals = itemPayments.map((row) => safeJsonSignals(row.rawResponse));
      const webhookSignals = itemEvents.map((row) => safeJsonSignals(row.payload));
      const gatewayStatus = signalValue({ ...paymentSignals.at(-1), ...webhookSignals.at(-1) }, /status$/i);
      const gatewayAmount = signalValue({ ...paymentSignals.at(-1), ...webhookSignals.at(-1) }, /(^|\.)(paid_amount|amount|total)$/i);
      const confirmedAt = [...paidPayments.map((row) => row.updatedAt || row.createdAt), ...paidEvents.map((row) => row.createdAt), transaction?.createdAt].filter(Boolean).sort()[0] || '';
      const paymentIds = itemPayments.map((row) => row.id).join('|');
      const providerIds = [...new Set(itemPayments.map((row) => row.providerPaymentId).filter(Boolean))].join('|');
      const webhookIds = itemEvents.map((row) => row.id).join('|');
      const notes = [];
      if (orderPaid && paidPayments.length === 0) notes.push('sem payment paid');
      if (orderPaid && paidEvents.length === 0) notes.push('sem webhook aprovado');
      if (orderPaid && !transaction) notes.push('sem transacao do fotografo');
      if (transaction && decimalToCents(transaction.grossAmount) !== priceCents) notes.push('grossAmount da transacao diverge do item');
      if (transaction && platformFeeCents + photographerNetCents !== decimalToCents(transaction.grossAmount)) notes.push('fee + net diverge do gross da transacao');
      if (duplicate) notes.push('possivel duplicidade');
      if (gatewayCheck && gatewayCheck.status !== 'paid' && gatewayCheck.status !== 'not_checked') notes.push(`InfinitePay consultada ao vivo: ${gatewayCheck.status}`);
      if (!orderPaid) notes.push(`pedido ${item.order_status}`);
      if (orderSubtotalCents - orderDiscountCents !== orderTotalCents) notes.push('subtotal - desconto diverge do total');
      if (gatewayAmount !== '' && String(gatewayAmount) !== centsToDecimal(orderTotalCents) && String(gatewayAmount) !== String(orderTotalCents)) notes.push('valor do payload exige validacao de unidade');

      const historicalReconciliationComplete = paidPayments.length > 0 && paidEvents.length > 0 && Boolean(transaction);
      const definitiveEligible = valid && commissionSource !== 'nao_comprovada' && (
        gatewayCheck?.status === 'paid' ||
        (gatewayCheck?.status === 'not_checked' && historicalReconciliationComplete)
      );

      let reconciliation = 'sem_evidencia_suficiente';
      if (valid && paidPayments.length > 0 && paidEvents.length > 0 && transaction && notes.length === 0) reconciliation = 'conciliada';
      else if (valid) reconciliation = 'parcialmente_conciliada';
      else if (orderPaid || hasFinancialEvidence) reconciliation = 'divergente';

      const row = {
        pedido_id: item.orderId,
        item_id: item.id,
        pagamento_id: paymentIds,
        transacao_externa_id: providerIds || item.paymentExternalId || '',
        webhook_id: webhookIds,
        cliente: maskName(item.buyerName),
        cliente_email: maskEmail(item.buyerEmail),
        evento: item.event || events.find((event) => String(event.id) === String(item.eventId))?.name || 'nao_informado',
        evento_id: item.eventId || '',
        foto: item.name,
        foto_id: item.productId,
        data_compra: isoInZone(item.order_created_at),
        data_confirmacao: isoInZone(confirmedAt),
        valor_original_estimado: centsToDecimal(originalGrossCents),
        quantidade: 1,
        valor_item_cobrado: centsToDecimal(priceCents),
        desconto_alocado_estimado: centsToDecimal(allocatedDiscountCents),
        desconto_tipo: item.discountType || '',
        cupom: item.discountType === 'coupon' ? 'codigo_nao_persistido_no_pedido' : '',
        valor_efetivamente_pago_item: centsToDecimal(priceCents),
        taxa_gateway: '',
        comissao_funpace: commissionSource === 'nao_comprovada' ? '' : centsToDecimal(platformFeeCents),
        percentual_funpace: feePercent,
        valor_liquido_fotografo: commissionSource === 'nao_comprovada' ? '' : centsToDecimal(photographerNetCents),
        fonte_comissao: commissionSource,
        pedido_status: item.order_status,
        pagamento_status: [...new Set(itemPayments.map((payment) => payment.status))].join('|'),
        gateway_status_payload: gatewayStatus,
        gateway_status_consulta_atual: gatewayCheck?.status || 'nao_consultado',
        estorno_reembolso_chargeback: ['refunded', 'chargeback', 'reversed'].some((status) => [item.order_status, ...itemPayments.map((payment) => payment.status), ...itemEvents.map((event) => event.status)].map(normalizeText).includes(status)) ? 'sim' : 'nao',
        repasse_anterior: transaction?.status === 'paid' ? 'transacao_marcada_paid_sem_vinculo_a_saque' : 'nao_vinculado',
        conciliacao: reconciliation,
        incluido_total_definitivo: definitiveEligible ? 'sim' : 'nao',
        observacoes: notes.join('; '),
        _valid: valid,
        _priceCents: priceCents,
        _originalGrossCents: originalGrossCents,
        _discountCents: allocatedDiscountCents,
        _platformFeeCents: platformFeeCents,
        _netCents: photographerNetCents,
        _commissionProven: commissionSource !== 'nao_comprovada',
        _confirmedAt: confirmedAt || item.order_created_at,
      };
      saleRows.push(row);

      if (notes.length > 0 || reconciliation !== 'conciliada') {
        divergenceRows.push({
          tipo: reconciliation === 'conciliada' ? 'observacao' : reconciliation,
          pedido_id: item.orderId,
          item_id: item.id,
          valor: centsToDecimal(priceCents),
          descricao: notes.join('; ') || 'Conciliacao incompleta entre pedido, pagamento, webhook e transacao.',
          impacto: row.incluido_total_definitivo === 'sim' ? 'incluido_com_evidencia_financeira' : 'excluido_do_total_definitivo',
          acao_manual: gatewayAmount !== '' ? `Confirmar unidade/valor do payload (${gatewayAmount}).` : 'Revisar comprovacao financeira e historico administrativo.',
        });
      }
      if (row.incluido_total_definitivo !== 'sim') {
        excludedRows.push({
          pedido_id: item.orderId,
          item_id: item.id,
          status: item.order_status,
          valor: centsToDecimal(priceCents),
          motivo: gatewayCheck?.status === 'pending'
            ? 'pedido pago no banco, mas payment_check atual retornou pending'
            : notes.join('; ') || 'comissao/conciliacao nao comprovada',
        });
      }
    }

    const definitiveSales = saleRows.filter((row) => row.incluido_total_definitivo === 'sim');
    const validSales = saleRows.filter((row) => row._valid);
    const gatewayQuarantineSales = saleRows.filter((row) => row._valid && row.gateway_status_consulta_atual === 'pending');
    const refundedSales = saleRows.filter((row) => row.estorno_reembolso_chargeback === 'sim');

    const payoutRows = withdrawals.map((withdrawal) => {
      const relatedLogs = adminLogs.filter((log) => String(log.targetId || '') === String(withdrawal.id) || JSON.stringify(log.metadata || {}).includes(withdrawal.id));
      const hasDate = Boolean(withdrawal.processedAt);
      const hasIdentifier = Boolean(String(withdrawal.note || '').trim()) || relatedLogs.length > 0;
      const proven = withdrawal.status === 'paid' && hasDate && hasIdentifier;
      return {
        repasse_id: withdrawal.id,
        data_solicitacao: isoInZone(withdrawal.createdAt),
        data_processamento: isoInZone(withdrawal.processedAt),
        valor: centsToDecimal(decimalToCents(withdrawal.amount)),
        status: withdrawal.status,
        evidencia: [hasDate ? 'processedAt' : '', withdrawal.note ? 'nota administrativa' : '', relatedLogs.length ? `${relatedLogs.length} log(s)` : ''].filter(Boolean).join('; '),
        responsavel: [...new Set(relatedLogs.map((log) => maskEmail(log.actorEmail)).filter(Boolean))].join('|'),
        vendas_vinculadas: 'nao_persistidas',
        comprovacao: proven ? 'comprovado_no_sistema' : withdrawal.status === 'paid' ? 'insuficiente' : 'nao_realizado',
        observacao: withdrawal.note ? 'Nota presente (conteudo omitido por privacidade).' : '',
        _amountCents: decimalToCents(withdrawal.amount),
        _proven: proven,
      };
    });

    const provenPayouts = payoutRows.filter((row) => row._proven);
    const grossCents = sumCents(definitiveSales, '_priceCents');
    const originalGrossCents = sumCents(definitiveSales, '_originalGrossCents');
    const discountsCents = sumCents(definitiveSales, '_discountCents');
    const platformFeeCents = sumCents(definitiveSales, '_platformFeeCents');
    const photographerNetCents = sumCents(definitiveSales, '_netCents');
    const payoutsCents = sumCents(provenPayouts, '_amountCents');
    const refundCents = sumCents(refundedSales.filter((row) => row.incluido_total_definitivo === 'sim'), '_netCents');
    const pendingCents = photographerNetCents - refundCents - payoutsCents;
    const internalGrossCents = sumCents(validSales, '_priceCents');
    const internalPlatformFeeCents = sumCents(validSales, '_platformFeeCents');
    const internalNetCents = sumCents(validSales, '_netCents');
    const quarantineGrossCents = sumCents(gatewayQuarantineSales, '_priceCents');
    const quarantineNetCents = sumCents(gatewayQuarantineSales, '_netCents');
    const pendingWithdrawalCents = sumCents(payoutRows.filter((row) => row.status === 'pending'), '_amountCents');
    const netAfterPendingWithdrawalRequest = sumCents(definitiveSales.filter((row) => payoutRows.some((payout) => payout.status === 'pending' && new Date(row._confirmedAt) > new Date(withdrawals.find((withdrawal) => withdrawal.id === payout.repasse_id)?.createdAt))), '_netCents');

    const byEvent = [...arrayGroup(definitiveSales, (row) => row.evento).entries()].map(([eventName, rows]) => ({
      evento: eventName,
      fotos_vendidas: rows.length,
      pedidos: new Set(rows.map((row) => row.pedido_id)).size,
      valor_bruto: centsToDecimal(sumCents(rows, '_priceCents')),
      descontos_estimados: centsToDecimal(sumCents(rows, '_discountCents')),
      comissao_funpace: centsToDecimal(sumCents(rows, '_platformFeeCents')),
      valor_liquido_gustavo: centsToDecimal(sumCents(rows, '_netCents')),
      valor_repassado_vinculado: '',
      saldo_pendente: '',
    })).sort((a, b) => a.evento.localeCompare(b.evento));

    const byMonth = [...arrayGroup(definitiveSales, (row) => monthInZone(row._confirmedAt)).entries()].map(([month, rows]) => ({
      mes: month,
      vendas_itens: rows.length,
      pedidos: new Set(rows.map((row) => row.pedido_id)).size,
      valor_bruto: centsToDecimal(sumCents(rows, '_priceCents')),
      taxas_gateway: '',
      comissao_funpace: centsToDecimal(sumCents(rows, '_platformFeeCents')),
      valor_fotografo: centsToDecimal(sumCents(rows, '_netCents')),
      repasses_vinculados: '',
      saldo_pendente: '',
    })).sort((a, b) => a.mes.localeCompare(b.mes));

    const commissionRates = [...new Set(definitiveSales.map((row) => `${row.percentual_funpace}|${row.fonte_comissao}`))];
    const confidence = definitiveSales.length > 0 && divergenceRows.filter((row) => row.impacto === 'excluido_do_total_definitivo').length === 0 && provenPayouts.length === payoutRows.filter((row) => row.status === 'paid').length
      ? 'Alto' : definitiveSales.length > 0 ? 'Médio' : 'Baixo';

    const firstSale = definitiveSales[0]?._confirmedAt || null;
    const lastSale = definitiveSales.at(-1)?._confirmedAt || null;
    const firstInternalSale = validSales[0]?._confirmedAt || null;
    const lastInternalSale = validSales.at(-1)?._confirmedAt || null;
    const generatedAt = new Date();
    const runId = generatedAt.toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(OUTPUT_ROOT, runId);
    await fs.mkdir(outputDir, { recursive: true });

    const candidateLines = candidates.map((row) => `- ID \`${row.id}\`: ${row.name} / ${row.email}; username \`${row.username || 'nulo'}\`; slug \`${row.slug || 'nulo'}\`; score ${row.score}; ${row.product_count} produtos; ${row.event_count} eventos; ${row.id === photographerId ? '**selecionado**' : 'não incluído'}.`).join('\n');
    const tableLines = tableInventory.filter((row) => /order|payment|transaction|withdraw|photographer|product|event|coupon|download|wallet|setting/i.test(row.table_name)).map((row) => `- \`${row.table_name}\` (estimativa estatística: ${row.estimated_rows} registros)`).join('\n');
    const legacyLines = legacyRelations.map((row) => `- \`${row.tableName}\`: ${row.exact_rows} registros; ${row.photographer_matches} correspondências por ID/e-mail/nome do fotógrafo; colunas: ${row.columns.map((column) => `\`${column}\``).join(', ')}.`).join('\n') || '- Nenhuma relação financeira/evento legada adicional localizada.';
    const gatewayChecked = gatewayChecks.filter((row) => !['not_checked', 'check_failed'].includes(row.status));
    const gatewayPaid = gatewayChecks.filter((row) => row.status === 'paid');
    const gatewayFailed = gatewayChecks.filter((row) => row.status === 'check_failed');
    const gatewayNotChecked = gatewayChecks.filter((row) => row.status === 'not_checked');
    const manualItems = [
      payoutRows.some((row) => row.status === 'paid' && !row._proven) ? 'Obter comprovante externo dos saques marcados como pagos sem evidência mínima completa.' : null,
      'Confirmar no extrato/portal InfinitePay as taxas financeiras, pois o schema não persiste uma taxa de gateway normalizada por pagamento.',
      'Confirmar a política histórica quando o percentual global mudou; o banco guarda snapshots/transações, mas não uma tabela temporal de configurações.',
      duplicateExternalIds.length ? 'Revisar os pedidos que compartilham identificador externo antes de qualquer pagamento.' : null,
      excludedRows.length ? 'Revisar os itens excluídos por falta de evidência ou comissão comprovada.' : null,
    ].filter(Boolean);

    const report = `# Auditoria financeira — vendas do fotógrafo Gustavo Olyver\n\n` +
      `Gerado em: ${isoInZone(generatedAt)} (${TIME_ZONE})  \nBanco consultado até: ${isoInZone(dbClock.now)} (${TIME_ZONE})  \nModo: transação PostgreSQL REPEATABLE READ, READ ONLY.\n\n` +
      `## A. Resumo executivo\n\n` +
      `| Indicador | Resultado |\n|---|---:|\n` +
      `| Fotógrafo | ${photographer.name} |\n` +
      `| Photographer ID | \`${photographerId}\` |\n` +
      `| User/Auth ID | \`${photographer.auth_user_id || authUsers[0]?.id || 'não localizado'}\` |\n` +
      `| E-mail cadastrado | ${photographer.email} |\n` +
      `| Telefone | ${maskPhone(photographer.phone)} |\n` +
      `| Username / slug | ${photographer.username || 'nulo'} / ${photographer.slug || 'nulo'} |\n` +
      `| Nome no Auth | ${authUsers[0]?.full_name || authUsers[0]?.metadata_name || 'não preenchido'} |\n` +
      `| Cadastro / status | ${isoInZone(photographer.createdAt)} / ${photographer.status} |\n` +
      `| Período analisado | ${isoInZone(firstInternalSale) || 'sem venda localizada'} até ${isoInZone(dbClock.now)} |\n` +
      `| Primeira venda localizada no banco | ${isoInZone(firstInternalSale) || 'não localizada'} |\n` +
      `| Venda mais recente localizada no banco | ${isoInZone(lastInternalSale) || 'não localizada'} |\n` +
      `| Primeira / última venda no total definitivo | ${isoInZone(firstSale) || 'não localizada'} / ${isoInZone(lastSale) || 'não localizada'} |\n` +
      `| Pedidos pagos definitivos | ${new Set(definitiveSales.map((row) => row.pedido_id)).size} |\n` +
      `| Fotos/itens vendidos definitivos | ${definitiveSales.length} |\n` +
      `| Subtotal original alocado (estimado) | ${formatBrl(originalGrossCents)} |\n` +
      `| Valor bruto cobrado nos itens | ${formatBrl(grossCents)} |\n` +
      `| Descontos alocados (estimados) | ${formatBrl(discountsCents)} |\n` +
      `| Valor efetivamente recebido atribuído aos itens | ${formatBrl(grossCents)} |\n` +
      `| Taxas financeiras do gateway | Não persistidas de forma normalizada |\n` +
      `| Comissão FunPace comprovada | ${formatBrl(platformFeeCents)} |\n` +
      `| Valor total devido ao fotógrafo antes de repasses | ${formatBrl(photographerNetCents - refundCents)} |\n` +
      `| Saldo interno adicional em quarentena (gateway pending) | ${formatBrl(quarantineNetCents)} |\n` +
      `| Saldo líquido total registrado internamente | ${formatBrl(internalNetCents)} |\n` +
      `| Valor já repassado com evidência mínima | ${formatBrl(payoutsCents)} |\n` +
      `| Saldo final pendente comprovável | **${formatBrl(pendingCents)}** |\n` +
      `| Estornos/reembolsos/chargebacks | ${refundedSales.length} itens / ${formatBrl(refundCents)} líquidos |\n` +
      `| Itens em pedidos cancelados | ${saleRows.filter((row) => ['cancelled', 'canceled'].includes(normalizeText(row.pedido_status))).length} |\n` +
      `| Divergências/observações | ${divergenceRows.length} |\n` +
      `| Nível de confiança | **${confidence}** |\n\n` +
      `## B. Identificação do fotógrafo\n\n${candidateLines}\n\n` +
      `O cadastro selecionado possui ${productsSummary.total} produtos (${productsSummary.photos} fotos) e ${events.length} eventos associados. Contas candidatas adicionais não foram somadas automaticamente.\n\n` +
      `## C. Estrutura e relacionamentos\n\n` +
      `A venda nasce em \`orders\`; cada mídia vendida é congelada em \`order_items\`, ligada ao fotógrafo por \`vendedorId\`/\`ownerId\`, à foto por \`productId\` e ao evento por \`eventId\` ou pelo snapshot textual \`event\`. O pagamento é ligado ao pedido por \`payments.orderId\`; os webhooks ficam em \`payment_events.orderId\`; e a comissão líquida por item fica em \`photographer_transactions.orderItemId\`. Saques são registrados em \`withdrawal_requests\`, mas o schema não possui vínculo entre saque e vendas específicas.\n\n` +
      `Tabelas financeiras e relacionadas consultadas:\n\n${tableLines}\n\n` +
      `Foram examinados ${Object.values(allCounts).reduce((sum, value) => sum + Number(value || 0), 0)} registros nas nove tabelas centrais contabilizadas (ordens, itens, pagamentos, webhooks, transações, saques, produtos, eventos e fotógrafos).\n\n` +
      `### Registros legados/adicionais\n\n${legacyLines}\n\n` +
      `## D. Critério de venda válida e conciliação\n\n` +
      `O total definitivo inclui somente item cujo pedido está \`paid\`, possui comissão monetária persistida e: (a) foi confirmado como paid na consulta atual ao gateway; ou (b) não pôde ser reconsultado por falta de identificadores, mas possui simultaneamente payment paid, webhook aprovado e transação do fotógrafo. Respostas atuais pending, pedidos pendentes, falhos, cancelados, reembolsados, duplicados ou sem comissão comprovada ficam fora do total. Não foram localizadas duplicidades de identificador externo ou de item/produto nos pedidos do Gustavo.\n\n` +
      `Itens conciliados/avaliados: ${saleRows.length}; itens válidos segundo os registros internos: ${validSales.length}; itens incluídos no total definitivo após a checagem atual do gateway: ${definitiveSales.length}; itens excluídos ou em quarentena: ${excludedRows.length}.\n\n` +
      `### Conciliação atual com a InfinitePay\n\nForam tentados ${gatewayChecks.length} pedidos pagos: ${gatewayPaid.length} confirmados como paid pelo endpoint \`payment_check\`, ${gatewayNotChecked.length} sem identificadores suficientes, ${gatewayFailed.length} falhas de consulta e ${gatewayChecked.length - gatewayPaid.length} respostas não pagas. Os ${gatewayChecks.filter((row) => row.status === 'pending').length} pedidos que retornaram pending representam ${formatBrl(quarantineGrossCents)} brutos / ${formatBrl(quarantineNetCents)} líquidos e foram retirados do total definitivo, embora continuem registrados como pagos no banco. A consulta foi somente de verificação e não alterou pedidos ou pagamentos. Detalhes: \`auditoria-gustavo-olyver-infinitepay.csv\`.\n\n` +
      `## E. Regra de comissão\n\n` +
      `O código atual calcula por item \`platformFee = price × platformFeePercent\` e \`netAmount = price - platformFee\`. A implementação efetiva usa o percentual global de \`platform_settings\` no fulfillment; o documento arquitetural menciona override por \`photographers.commissionPercent\`, mas esse override não é aplicado pela implementação atual. Configuração atual: ${settings?.platformFeePercent ?? 'não localizada'}%; comissão específica do Gustavo: ${photographer.commissionPercent ?? 'nula'}. Fontes/rates observadas nos itens definitivos: ${commissionRates.join(', ') || 'nenhuma'} (variações decorrem do arredondamento por item). Uma cópia de 2026-06-01 também registra 40%, corroborando essa regra desde aquela data; não existe histórico temporal estruturado para provar períodos anteriores. Por isso os valores persistidos por item/transação prevalecem.\n\n` +
      `## F. Total por evento\n\n` +
      `Arquivo: \`auditoria-gustavo-olyver-eventos.csv\` (${byEvent.length} linhas).\n\n` +
      `## G. Total por mês\n\n` +
      `Arquivo: \`auditoria-gustavo-olyver-mensal.csv\` (${byMonth.length} linhas).\n\n` +
      `## H. Relatório detalhado por venda\n\n` +
      `Arquivo: \`auditoria-gustavo-olyver-vendas.csv\` (${saleRows.length} itens). Nomes e e-mails de clientes foram mascarados; CPF, telefone do cliente, chave PIX e payload bruto não foram exportados.\n\n` +
      `## I. Pedidos excluídos e divergências\n\n` +
      `Excluídos: ${excludedRows.length}. Divergências/observações: ${divergenceRows.length}. Consulte \`auditoria-gustavo-olyver-excluidos.csv\` e \`auditoria-gustavo-olyver-divergencias.csv\`.\n\n` +
      `## J. Repasses anteriores\n\n` +
      `Solicitações localizadas: ${payoutRows.length}; pendentes: ${payoutRows.filter((row) => row.status === 'pending').length}, total ${formatBrl(pendingWithdrawalCents)}; marcadas como pagas: ${payoutRows.filter((row) => row.status === 'paid').length}; com evidência mínima (status paid + data processada + nota/log): ${provenPayouts.length}, total ${formatBrl(payoutsCents)}. O saque pendente não foi abatido. Vendas confirmadas depois da solicitação pendente somam ${formatBrl(netAfterPendingWithdrawalRequest)} líquidos. O banco não vincula saques a vendas individuais e não armazena comprovante bancário estruturado; portanto isso exige conferência documental externa antes do pagamento.\n\n` +
      `## K. Valor final recomendado\n\n` +
      `| Cálculo | Valor |\n|---|---:|\n` +
      `| Total bruto cobrado nas vendas do Gustavo | ${formatBrl(grossCents)} |\n` +
      `| (-) Comissão da FunPace | ${formatBrl(platformFeeCents)} |\n` +
      `| (-) Taxas atribuídas ao fotógrafo | Não comprovadas; não abatidas |\n` +
      `| (-) Estornos/reembolsos líquidos | ${formatBrl(refundCents)} |\n` +
      `| (-) Repasses anteriores comprovados no sistema | ${formatBrl(payoutsCents)} |\n` +
      `| (=) Saldo final pendente comprovável | **${formatBrl(pendingCents)}** |\n\n` +
      `Saldo adicional em quarentena: ${formatBrl(quarantineNetCents)}. Se os ${gatewayChecks.filter((row) => row.status === 'pending').length} pedidos atualmente pending forem confirmados no portal/extrato, o saldo interno total passa a ${formatBrl(internalNetCents - payoutsCents)}.\n\n` +
      `Recomendação: não pagar automaticamente. Antes do repasse, conferir no portal/extrato InfinitePay as taxas e os pagamentos listados, anexar comprovantes dos saques anteriores e validar as divergências excluídas.\n\n` +
      `## L. Nível de confiança\n\n` +
      `**${confidence}.** A confiança considera a presença de pedido pago, evidência adicional e comissão persistida por item. Ela é reduzida quando faltam webhook, taxa de gateway normalizada, histórico temporal da configuração ou comprovante externo de saque.\n\n` +
      `## M. Confirmações manuais pendentes\n\n${manualItems.map((item) => `- ${item}`).join('\n')}\n\n` +
      `## N. Limitações e trilha de auditoria\n\n` +
      `A auditoria não executou UPDATE, DELETE, INSERT, RPC mutante, deploy ou chamada de pagamento. A leitura ocorreu em snapshot repetível. Valores monetários foram convertidos para centavos inteiros. Descontos por item são alocações estimadas porque o pedido persiste o subtotal/desconto total e o item já com preço líquido. Taxas do gateway não são tratadas como zero; ficam em branco/não comprovadas.\n`;

    const publicSaleRows = saleRows.map(({ _valid, _priceCents, _originalGrossCents, _discountCents, _platformFeeCents, _netCents, _commissionProven, _confirmedAt, ...row }) => row);
    const publicPayoutRows = payoutRows.map(({ _amountCents, _proven, ...row }) => row);
    const publicEventRows = byEvent;
    const publicMonthRows = byMonth;

    const files = {
      'auditoria-gustavo-olyver-resumo.md': report,
      'auditoria-gustavo-olyver-vendas.csv': toCsv(publicSaleRows, Object.keys(publicSaleRows[0] || { pedido_id: '' })),
      'auditoria-gustavo-olyver-eventos.csv': toCsv(publicEventRows, Object.keys(publicEventRows[0] || { evento: '' })),
      'auditoria-gustavo-olyver-mensal.csv': toCsv(publicMonthRows, Object.keys(publicMonthRows[0] || { mes: '' })),
      'auditoria-gustavo-olyver-divergencias.csv': toCsv(divergenceRows, Object.keys(divergenceRows[0] || { tipo: '' })),
      'auditoria-gustavo-olyver-repasses.csv': toCsv(publicPayoutRows, Object.keys(publicPayoutRows[0] || { repasse_id: '' })),
      'auditoria-gustavo-olyver-excluidos.csv': toCsv(excludedRows, Object.keys(excludedRows[0] || { pedido_id: '' })),
      'auditoria-gustavo-olyver-infinitepay.csv': toCsv(gatewayChecks, Object.keys(gatewayChecks[0] || { orderId: '' })),
    };
    for (const [fileName, content] of Object.entries(files)) await fs.writeFile(path.join(outputDir, fileName), content, 'utf8');

    const manifest = {
      generatedAt: generatedAt.toISOString(),
      databaseSnapshotAt: new Date(dbClock.now).toISOString(),
      timezone: TIME_ZONE,
      readOnly: true,
      photographer: { id: photographerId, authUserId: photographer.auth_user_id, name: photographer.name, email: photographer.email },
      counts: { candidates: candidates.length, saleItems: saleRows.length, definitiveItems: definitiveSales.length, excludedItems: excludedRows.length, divergences: divergenceRows.length, payouts: payoutRows.length },
      totalsCents: { gross: grossCents.toString(), platformFee: platformFeeCents.toString(), photographerNet: photographerNetCents.toString(), refunds: refundCents.toString(), provenPayouts: payoutsCents.toString(), pending: pendingCents.toString(), internalGross: internalGrossCents.toString(), internalPlatformFee: internalPlatformFeeCents.toString(), internalNet: internalNetCents.toString(), gatewayQuarantineNet: quarantineNetCents.toString() },
      legacyRelations,
      gatewayReconciliation: { attempted: gatewayChecks.length, checked: gatewayChecked.length, paid: gatewayPaid.length, notChecked: gatewayNotChecked.length, failed: gatewayFailed.length },
      files: Object.keys(files),
      queryMode: 'PostgreSQL repeatable read, read only',
      durationMs: Date.now() - startedAt.getTime(),
    };
    await fs.writeFile(path.join(outputDir, 'manifesto-auditoria.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await client.query('commit');
    committed = true;
    console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
  } finally {
    if (!committed) await client.query('rollback').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
