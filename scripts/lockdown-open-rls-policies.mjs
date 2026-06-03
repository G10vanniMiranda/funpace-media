import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const policiesToDrop = [
  { schema: 'public', table: 'orders', policy: 'liberar' },
  { schema: 'public', table: 'order_items', policy: 'liberar' },
  { schema: 'public', table: 'download_access', policy: 'liberar' },
  { schema: 'public', table: 'download_events', policy: 'liberar' },
  { schema: 'public', table: 'payments', policy: 'liberar' },
  { schema: 'public', table: 'payment_events', policy: 'liberar' },
  { schema: 'public', table: 'products', policy: 'liberar' },
  { schema: 'storage', table: 'objects', policy: 'liberar 1bsoywt_0' },
  { schema: 'storage', table: 'objects', policy: 'liberar 1bsoywt_1' },
  { schema: 'storage', table: 'objects', policy: 'liberar 1bsoywt_2' },
  { schema: 'storage', table: 'objects', policy: 'liberar 1bsoywt_3' },
  { schema: 'public', table: 'admin_activity_logs', policy: 'liberar' },
  { schema: 'public', table: 'codex_connection_test', policy: 'liberar' },
  { schema: 'public', table: 'coupons', policy: 'liberar' },
  { schema: 'public', table: 'customer_favorites', policy: 'liberar' },
  { schema: 'public', table: 'customers', policy: 'liberar' },
  { schema: 'public', table: 'downloads', policy: 'liberar' },
  { schema: 'public', table: 'media_processing_jobs', policy: 'liberar' },
  { schema: 'public', table: 'photographer_transactions', policy: 'liberar' },
  { schema: 'public', table: 'photographer_wallets', policy: 'liberar' },
  { schema: 'public', table: 'photographers', policy: 'liberar' },
  { schema: 'public', table: 'platform_settings', policy: 'liberar' },
  { schema: 'public', table: 'product_likes', policy: 'liberar' },
  { schema: 'public', table: 'user_sessions', policy: 'liberar' },
  { schema: 'public', table: 'withdrawal_requests', policy: 'liberar' },
];

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function policyExists(input) {
  const result = await client.query(
    `select exists (
      select 1
      from pg_policies
      where schemaname = $1
        and tablename = $2
        and policyname = $3
    ) as exists`,
    [input.schema, input.table, input.policy],
  );
  return Boolean(result.rows[0]?.exists);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL nao configurada.');
  }

  await client.connect();

  const dropped = [];
  const skipped = [];

  for (const item of policiesToDrop) {
    if (!(await policyExists(item))) {
      skipped.push(item);
      continue;
    }

    await client.query(
      `drop policy ${quoteIdent(item.policy)} on ${quoteIdent(item.schema)}.${quoteIdent(item.table)}`,
    );
    dropped.push(item);
  }

  const remainingBroadPolicies = await client.query(`
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (
        lower(policyname) = 'liberar'
        or lower(policyname) like 'liberar %'
        or (cmd = 'ALL' and qual = 'true' and with_check = 'true')
      )
    order by schemaname, tablename, policyname
  `);

  console.log(JSON.stringify({
    completedAt: new Date().toISOString(),
    dropped,
    skipped,
    remainingBroadPolicies: remainingBroadPolicies.rows,
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
