import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

function readFirstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

const supabaseUrl = readFirstEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
const supabaseKey = readFirstEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']);

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente.');
}

async function supabaseRequest(pathname) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.hint || raw || `Supabase HTTP ${response.status}`);
  }

  return data;
}

async function fetchTable(tableName, select) {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      select,
      limit: String(pageSize),
      offset: String(offset),
      order: 'createdAt.asc',
    });
    const batch = await supabaseRequest(`/rest/v1/${encodeURIComponent(tableName)}?${params.toString()}`);

    if (!Array.isArray(batch)) {
      throw new Error(`Resposta inesperada ao consultar ${tableName}.`);
    }

    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function numberValue(value) {
  return Number(value || 0);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(rows, key) {
  return roundMoney(rows.reduce((acc, row) => acc + numberValue(row[key]), 0));
}

function groupBy(rows, key) {
  return Object.values(rows.reduce((acc, row) => {
    const name = String(row[key] || 'nao_informado');
    acc[name] ||= { name, count: 0, total: 0 };
    acc[name].count += 1;
    acc[name].total = roundMoney(acc[name].total + numberValue(row.total));
    return acc;
  }, {})).sort((a, b) => b.total - a.total || b.count - a.count);
}

function paidByMonth(rows) {
  return Object.values(rows.reduce((acc, row) => {
    const month = String(row.createdAt || '').slice(0, 7) || 'sem_data';
    acc[month] ||= { month, count: 0, total: 0 };
    acc[month].count += 1;
    acc[month].total = roundMoney(acc[month].total + numberValue(row.total));
    return acc;
  }, {})).sort((a, b) => a.month.localeCompare(b.month));
}

async function main() {
  const orders = await fetchTable(
    'orders',
    'id,total,subtotal,discountTotal,status,paymentMethod,paymentProvider,createdAt,updatedAt',
  );
  const paidOrders = orders.filter((order) => String(order.status || '').toLowerCase() === 'paid');

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'supabase.orders',
    criteria: {
      paidSales: 'orders.status = paid',
    },
    summary: {
      ordersTotal: orders.length,
      paidSales: paidOrders.length,
      paidGrossTotal: sum(paidOrders, 'total'),
      paidSubtotalTotal: sum(paidOrders, 'subtotal'),
      paidDiscountTotal: sum(paidOrders, 'discountTotal'),
      firstPaidAt: paidOrders[0]?.createdAt || null,
      lastPaidAt: paidOrders.at(-1)?.createdAt || null,
    },
    breakdowns: {
      byStatus: groupBy(orders, 'status'),
      paidByPaymentMethod: groupBy(paidOrders, 'paymentMethod'),
      paidByPaymentProvider: groupBy(paidOrders, 'paymentProvider'),
      paidByMonth: paidByMonth(paidOrders),
    },
  };

  await fs.mkdir('reports', { recursive: true });
  const outputFile = path.join('reports', `sales-analysis-${new Date().toISOString().slice(0, 10)}.json`);
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({ reportFile: outputFile, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
