import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const defaultTables = [
  'photographers',
  'customers',
  'events',
  'products',
  'orders',
  'order_items',
  'payments',
  'payment_events',
  'download_access',
  'download_events',
  'downloads',
  'product_likes',
  'customer_favorites',
  'withdrawal_requests',
  'photographer_wallets',
  'photographer_transactions',
  'platform_settings',
  'coupons',
  'admin_activity_logs',
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1] || path.join('backups', stamp);
const selectedTables = process.argv.find((arg) => arg.startsWith('--tables='))?.split('=')[1]
  ?.split(',')
  .map((table) => table.trim())
  .filter(Boolean) || defaultTables;
const pageSize = Math.min(Math.max(Number(process.argv.find((arg) => arg.startsWith('--page-size='))?.split('=')[1] || 1000), 100), 5000);

function requireEnv(name, fallbackNames = []) {
  const value = [name, ...fallbackNames].map((key) => process.env[key]).find((item) => String(item || '').trim());
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return String(value).trim();
}

const supabaseUrl = requireEnv('SUPABASE_URL', ['NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY']);

async function supabaseRequest(pathname, init = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Supabase HTTP ${response.status}`);
  }
  return data;
}

async function exportTable(tableName) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: '*',
      limit: String(pageSize),
      offset: String(offset),
    });
    const batch = await supabaseRequest(`/rest/v1/${encodeURIComponent(tableName)}?${query.toString()}`);
    if (!Array.isArray(batch)) {
      throw new Error(`Resposta inesperada ao exportar ${tableName}.`);
    }
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const databaseDir = path.join(outputRoot, 'database');
  const manifest = {
    generatedAt: new Date().toISOString(),
    type: 'supabase-rest-json',
    supabaseUrl,
    outputRoot,
    pageSize,
    tables: [],
    warnings: [],
  };

  console.log('backupSupabase:start', { outputRoot, tables: selectedTables.length, pageSize });

  for (const table of selectedTables) {
    try {
      const rows = await exportTable(table);
      const filePath = path.join(databaseDir, `${table}.json`);
      await writeJson(filePath, rows);
      manifest.tables.push({ table, rows: rows.length, file: path.relative(outputRoot, filePath).replace(/\\/g, '/') });
      console.log('backupSupabase:table', { table, rows: rows.length });
    } catch (error) {
      const warning = { table, error: error?.message || String(error) };
      manifest.warnings.push(warning);
      console.error('backupSupabase:warning', warning);
    }
  }

  await writeJson(path.join(outputRoot, 'backup-manifest.json'), manifest);
  console.log('backupSupabase:done', {
    outputRoot,
    exportedTables: manifest.tables.length,
    warnings: manifest.warnings.length,
  });
}

main().catch((error) => {
  console.error('backupSupabase:failed', { message: error?.message || String(error) });
  process.exitCode = 1;
});
