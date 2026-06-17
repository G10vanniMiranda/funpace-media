function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getBearerToken(req: any) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase Service Role não configurado.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    serviceRoleKey,
    anonKey,
  };
}

async function getAuthenticatedAdminUser(req: any) {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;
  const user: any = await response.json().catch(() => null);
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super_admin') return null;
  return user?.id ? user : null;
}

async function supabaseRequest<T>(path: string): Promise<T> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.hint || raw || `Supabase HTTP ${response.status}`);
  }

  return data as T;
}

function byOrderId(items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const current = groups.get(item.orderId) ?? [];
    current.push(item);
    groups.set(item.orderId, current);
  }
  return groups;
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) return res.status(403).json({ error: 'Acesso admin não autorizado.' });

    const [
      photographers,
      products,
      orders,
      orderItems,
      withdrawals,
      customers,
      payments,
      paymentEvents,
      coupons,
      adminLogs,
      platformSettingsRows,
    ] = await Promise.all([
      supabaseRequest<any[]>('/rest/v1/photographers?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/products?select=*&order=createdAt.desc&limit=10000'),
      supabaseRequest<any[]>('/rest/v1/orders?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/order_items?select=*&order=createdAt.asc&limit=20000'),
      supabaseRequest<any[]>('/rest/v1/withdrawal_requests?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/customers?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/payments?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/payment_events?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/coupons?select=*&order=createdAt.desc&limit=1000'),
      supabaseRequest<any[]>('/rest/v1/admin_activity_logs?select=*&order=createdAt.desc&limit=5000'),
      supabaseRequest<any[]>('/rest/v1/platform_settings?select=*&id=eq.default&limit=1'),
    ]);

    const itemsByOrderId = byOrderId(orderItems);

    return res.status(200).json({
      photographers,
      products,
      orders: orders.map((order) => ({ ...order, items: itemsByOrderId.get(order.id) ?? [] })),
      withdrawals,
      customers,
      payments,
      paymentEvents,
      coupons,
      adminLogs,
      platformSettings: platformSettingsRows[0] || { platformFeePercent: 30 },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro ao carregar snapshot admin.' });
  }
}
