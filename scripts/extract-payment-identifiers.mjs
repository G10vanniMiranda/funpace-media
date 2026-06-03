import dotenv from 'dotenv';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const searches = process.argv.slice(2);
if (searches.length === 0) {
  console.error('Uso: node scripts/extract-payment-identifiers.mjs <order-id-ou-prefixo> [...]');
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

function normalizeKey(value) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getPayloadValue(payload, names) {
  const wanted = new Set(names.map(normalizeKey));
  const queue = [payload];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return '';
}

function extractPaymentIdentifiers(...sources) {
  const transactionNames = ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu', 'payment_id', 'paymentId'];
  const slugNames = ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId'];
  let transactionNsu = '';
  let slug = '';

  for (const source of sources) {
    if (!transactionNsu) transactionNsu = getPayloadValue(source, transactionNames);
    if (!slug) slug = getPayloadValue(source, slugNames);
  }

  for (const source of sources) {
    const urls = [source?.checkoutUrl, source?.url, source?.link, source?.checkout_url, source?.payment_url].filter(Boolean);
    for (const url of urls) {
      try {
        const parsed = new URL(String(url));
        if (!transactionNsu) transactionNsu = transactionNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
        if (!slug) slug = slugNames.map((name) => parsed.searchParams.get(name)).find(Boolean) || '';
      } catch {
        // Ignore invalid URLs.
      }
    }
  }

  return { transactionNsu, slug };
}

function summarizeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return {
      host: parsed.host,
      path: parsed.pathname,
      queryKeys: [...parsed.searchParams.keys()],
    };
  } catch {
    return { host: '', path: '', queryKeys: [] };
  }
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
    for (const search of searches) {
      const orders = await pool.query(
        `
          select *
          from public.orders
          where id::text = $1 or id::text ilike $2
          order by "createdAt" desc
          limit 5
        `,
        [search, `${search}%`],
      );

      for (const order of orders.rows) {
        const payments = await pool.query(
          `select "providerPaymentId", "rawResponse" from public.payments where "orderId" = $1 order by "createdAt" desc`,
          [order.id],
        );
        const events = await pool.query(
          `select payload from public.payment_events where "orderId" = $1 order by "createdAt" desc limit 10`,
          [order.id],
        );
        const sources = [
          order,
          ...payments.rows.map((payment) => payment.rawResponse || {}),
          ...events.rows.map((event) => event.payload || {}),
        ];
        const identifiers = extractPaymentIdentifiers(...sources);
        const urls = [order.checkoutUrl, ...payments.rows.map((payment) => payment.rawResponse?.url)].filter(Boolean);
        console.log(JSON.stringify({
          id: order.id,
          status: order.status,
          paymentExternalId: order.paymentExternalId,
          providerPaymentIds: payments.rows.map((payment) => payment.providerPaymentId),
          identifiers,
          urls: urls.map(summarizeUrl),
        }, null, 2));
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
