import pg from 'pg';

const { Pool } = pg;

export function setCors(req: any, res: any) {
  const allowedOrigins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function handleOptions(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function getDbConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DATABASE || 'postgres',
        user: process.env.DB_USER || process.env.USER || 'postgres',
        password: process.env.POSTGRES || process.env.RAILS_MASTER_KEY,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };
}

export function createPool() {
  return new Pool(getDbConfig());
}

export function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getInfinitePayCheckoutEndpoint() {
  return process.env.INFINITEPAY_CHECKOUT_ENDPOINT || 'https://api.checkout.infinitepay.io/links';
}

export function getInfinitePayPaymentCheckEndpoint() {
  return process.env.INFINITEPAY_PAYMENT_CHECK_ENDPOINT ||
    `${(process.env.INFINITEPAY_BASE_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '')}/payment_check`;
}
