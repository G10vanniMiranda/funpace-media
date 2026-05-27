function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

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

function isTrustedOrigin(req: any) {
  const allowedOrigins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin) return allowedOrigins.has(origin);

  try {
    const refererOrigin = new URL(String(req.headers.referer || '')).origin.replace(/\/+$/, '');
    return !refererOrigin || allowedOrigins.has(refererOrigin);
  } catch {
    return true;
  }
}

function handleOptions(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase()) && !isTrustedOrigin(req)) {
    res.status(403).json({ error: 'Origem nao autorizada.' });
    return true;
  }
  return false;
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getSupabaseApiConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role nao configurado nas variaveis de ambiente da Vercel.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Erro Supabase HTTP ${response.status}`);
  }

  return data as T;
}

function getBearerToken(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

function publicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;

  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, '')}/${encodeURI(rawPathOrUrl.replace(/^\/+/, ''))}`;
  }

  return rawPathOrUrl;
}

async function createSignedMediaUrl(rawPathOrUrl: string) {
  return publicMediaUrl(rawPathOrUrl);
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const body = getJsonBody(req);
    const orderId = String(body?.orderId || '');
    const orderItemId = String(body?.orderItemId || '');
    const authUser = await getAuthenticatedRequestUser(req);

    if (!isUuid(orderId) || !isUuid(orderItemId)) {
      return res.status(400).json({ error: 'Download invalido.' });
    }

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente para baixar sua compra.' });
    }

    const orderItems = await supabaseRequest<any[]>(
      `/rest/v1/order_items?select=*&id=eq.${encodeURIComponent(orderItemId)}&limit=1`,
    );
    const item = orderItems[0];

    if (!item || item.orderId !== orderId) {
      return res.status(404).json({ error: 'Item do pedido nao encontrado.' });
    }

    const orders = await supabaseRequest<any[]>(
      `/rest/v1/orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    const order = orders[0];

    if (!order || order.status !== 'paid') {
      return res.status(403).json({ error: 'Download liberado apenas para pedidos pagos.' });
    }

    const buyerEmail = String(order.buyerEmail || '').trim().toLowerCase();
    const authEmail = String(authUser.email || '').trim().toLowerCase();
    const belongsToUser = order.userId === authUser.id || (buyerEmail && authEmail && buyerEmail === authEmail);

    if (!belongsToUser) {
      return res.status(403).json({ error: 'Este pedido nao pertence ao usuario logado.' });
    }

    const products = await supabaseRequest<any[]>(
      `/rest/v1/products?select=*&id=eq.${encodeURIComponent(item.productId)}&limit=1`,
    );
    const product = products[0];

    await supabaseRequest('/rest/v1/download_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        orderId: item.orderId,
        orderItemId: item.id,
        productId: item.productId,
        vendedorId: item.vendedorId,
        buyerEmail: order.buyerEmail,
        userId: order.userId,
        ipHash: null,
        userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
      }),
    }).catch((error) => {
      console.error('Nao foi possivel registrar evento de download:', error);
    });

    const url = await createSignedMediaUrl(item.url || product?.storagePath || '');
    return res.status(200).json({ url });
  } catch (error: any) {
    console.error('Erro ao autorizar download:', error);
    return res.status(500).json({ error: error?.message || 'Nao foi possivel autorizar o download.' });
  }
}
