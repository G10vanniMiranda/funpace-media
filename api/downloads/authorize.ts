import { createHmac, timingSafeEqual } from 'crypto';

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

function getDownloadSecret() {
  return process.env.DOWNLOAD_TOKEN_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    'funpace-dev-download-secret';
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signDownloadPayload(payload: Record<string, unknown>) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getDownloadSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyDownloadToken(token: string) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw new Error('Token de download invalido.');

  const expected = createHmac('sha256', getDownloadSecret()).update(body).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new Error('Token de download invalido.');
    }
  } catch {
    throw new Error('Token de download invalido.');
  }

  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload?.orderId || !payload?.orderItemId || !payload?.exp) {
    throw new Error('Token de download incompleto.');
  }
  if (Number(payload.exp) <= Date.now()) {
    throw new Error('Link temporario expirado. Clique em baixar novamente.');
  }
  return payload as { orderId: string; orderItemId: string; userId: string; email: string };
}

function safeFilename(name: string, fallback: string) {
  const cleaned = String(name || fallback || 'funpace-media')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return cleaned || fallback || 'funpace-media';
}

function filenameForItem(item: any) {
  const rawUrl = String(item?.url || '');
  try {
    const last = new URL(rawUrl).pathname.split('/').pop() || '';
    if (/\.[a-z0-9]{2,6}$/i.test(last)) return safeFilename(last, item?.name);
  } catch {
    // Ignore invalid URLs.
  }
  const ext = item?.type === 'VIDEO' ? '.mp4' : item?.type === 'IMG' ? '.jpg' : '';
  return `${safeFilename(item?.name, 'funpace-media')}${ext}`;
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAuthorizedDownload(input: {
  orderId: string;
  orderItemId: string;
  userId: string;
  email: string | null;
}) {
  const { orderId, orderItemId } = input;

  if (!isUuid(orderId) || !isUuid(orderItemId)) {
    throw Object.assign(new Error('Download invalido.'), { statusCode: 400 });
  }

  const orderItems = await supabaseRequest<any[]>(
    `/rest/v1/order_items?select=*&id=eq.${encodeURIComponent(orderItemId)}&limit=1`,
  );
  const item = orderItems[0];

  if (!item || item.orderId !== orderId) {
    throw Object.assign(new Error('Item do pedido nao encontrado.'), { statusCode: 404 });
  }

  const orders = await supabaseRequest<any[]>(
    `/rest/v1/orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = orders[0];

  if (!order || order.status !== 'paid') {
    throw Object.assign(new Error('Download liberado apenas para pedidos pagos.'), { statusCode: 403 });
  }

  const buyerEmail = String(order.buyerEmail || '').trim().toLowerCase();
  const authEmail = String(input.email || '').trim().toLowerCase();
  const belongsToUser = order.userId === input.userId || (buyerEmail && authEmail && buyerEmail === authEmail);

  if (!belongsToUser) {
    throw Object.assign(new Error('Este pedido nao pertence ao usuario logado.'), { statusCode: 403 });
  }

  const accessRows = await supabaseRequest<any[]>(
    `/rest/v1/download_access?select=*&orderId=eq.${encodeURIComponent(orderId)}&photoId=eq.${encodeURIComponent(item.productId)}&isActive=eq.true&limit=1`,
  ).catch(() => []);
  const access = accessRows[0];
  const isExpired = access?.expiresAt ? new Date(access.expiresAt).getTime() <= Date.now() : false;

  if (access && isExpired) {
    const expiresAt = new Date(Date.now() + Number(process.env.DOWNLOAD_ACCESS_DAYS || 30) * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest(`/rest/v1/download_access?orderId=eq.${encodeURIComponent(orderId)}&photoId=eq.${encodeURIComponent(item.productId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ isActive: true, expiresAt }),
    });
  }

  if (!access) {
    const expiresAt = new Date(Date.now() + Number(process.env.DOWNLOAD_ACCESS_DAYS || 30) * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest('/rest/v1/download_access?on_conflict=orderId,photoId', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        orderId,
        photoId: item.productId,
        orderItemId: item.id,
        userId: order.userId || null,
        customerEmail: order.buyerEmail,
        isActive: true,
        expiresAt,
      }),
    }).catch((error) => {
      console.error('Nao foi possivel criar acesso de download:', error);
    });
  }

  const products = await supabaseRequest<any[]>(
    `/rest/v1/products?select=*&id=eq.${encodeURIComponent(item.productId)}&limit=1`,
  );
  const product = products[0];
  const source = item.url || product?.storagePath || product?.url || '';
  if (!source) {
    throw Object.assign(new Error('Arquivo original nao encontrado para este item.'), { statusCode: 404 });
  }

  const sourceUrl = await createSignedMediaUrl(source);
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw Object.assign(new Error('Arquivo original sem URL publica configurada no armazenamento.'), { statusCode: 404 });
  }

  return { order, item, product, sourceUrl };
}

async function recordDownload(req: any, order: any, item: any) {
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

  await supabaseRequest('/rest/v1/downloads', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      orderId: item.orderId,
      photoId: item.productId,
      userId: order.userId,
    }),
  }).catch((error) => {
    console.error('Nao foi possivel registrar download do cliente:', error);
  });
}

async function proxyDownload(req: any, res: any, token: string, inline: boolean) {
  const payload = verifyDownloadToken(token);
  const { order, item, sourceUrl } = await loadAuthorizedDownload({
    orderId: payload.orderId,
    orderItemId: payload.orderItemId,
    userId: payload.userId,
    email: payload.email,
  });

  const upstream = await fetch(sourceUrl);
  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 404 ? 404 : 502;
    return res.status(status).json({ error: status === 404 ? 'Arquivo nao encontrado no armazenamento.' : 'Nao foi possivel acessar o arquivo no armazenamento.' });
  }

  await recordDownload(req, order, item);

  const filename = filenameForItem(item);
  const contentType = upstream.headers.get('content-type') || (item.type === 'VIDEO' ? 'video/mp4' : 'image/jpeg');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  const arrayBuffer = await upstream.arrayBuffer();
  return res.status(200).send(Buffer.from(arrayBuffer));
}

function renderSavePage(req: any, res: any, token: string) {
  const baseUrl = safeReturnPath(req);
  const inlineUrl = `${baseUrl}?token=${encodeURIComponent(token)}&mode=inline`;
  const downloadUrl = `${baseUrl}?token=${encodeURIComponent(token)}&mode=download`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Download Funpace Media</title>
  <style>
    body{margin:0;background:#0b0f16;color:#fff;font-family:Arial,sans-serif}
    main{min-height:100svh;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;padding:16px}
    img,video{max-width:100%;max-height:78svh;object-fit:contain;background:#000}
    a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;background:#ff4e00;color:#fff;text-decoration:none;font-weight:800;text-transform:uppercase}
    p{max-width:520px;color:#cbd5e1;font-size:12px;text-align:center;text-transform:uppercase;line-height:1.5}
  </style>
</head>
<body>
  <main>
    <img src="${htmlEscape(inlineUrl)}" alt="Arquivo comprado Funpace Media">
    <a href="${htmlEscape(downloadUrl)}">Baixar arquivo</a>
    <p>No celular, se o download nao iniciar, toque e segure na imagem para salvar.</p>
  </main>
</body>
</html>`);
}

function safeReturnPath(req: any) {
  const proto = req.headers?.['x-forwarded-proto'] || 'https';
  const host = req.headers?.host || 'funpace.media';
  return `${proto}://${host}/api/downloads/authorize`;
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method === 'GET') {
    try {
      const token = String(req.query?.token || '');
      const mode = String(req.query?.mode || 'download');
      if (mode === 'save') return renderSavePage(req, res, token);
      return await proxyDownload(req, res, token, mode === 'inline');
    } catch (error: any) {
      const status = error?.statusCode || (/expirado|token/i.test(error?.message || '') ? 403 : 500);
      return res.status(status).json({ error: error?.message || 'Nao foi possivel baixar o arquivo.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const body = getJsonBody(req);
    const orderId = String(body?.orderId || '');
    const orderItemId = String(body?.orderItemId || '');
    const authUser = await getAuthenticatedRequestUser(req);

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente para baixar sua compra.' });
    }

    const { order, item } = await loadAuthorizedDownload({
      orderId,
      orderItemId,
      userId: authUser.id,
      email: authUser.email,
    });
    const token = signDownloadPayload({
      orderId,
      orderItemId,
      userId: authUser.id,
      email: authUser.email || '',
      exp: Date.now() + Number(process.env.DOWNLOAD_LINK_TTL_SECONDS || 300) * 1000,
    });
    const baseUrl = safeReturnPath(req);
    const filename = filenameForItem(item);

    return res.status(200).json({
      url: `${baseUrl}?token=${encodeURIComponent(token)}&mode=download`,
      downloadUrl: `${baseUrl}?token=${encodeURIComponent(token)}&mode=download`,
      inlineUrl: `${baseUrl}?token=${encodeURIComponent(token)}&mode=inline`,
      saveUrl: `${baseUrl}?token=${encodeURIComponent(token)}&mode=save`,
      filename,
      orderId: order.id,
      orderItemId: item.id,
      expiresInSeconds: Number(process.env.DOWNLOAD_LINK_TTL_SECONDS || 300),
    });
  } catch (error: any) {
    console.error('Erro ao autorizar download:', error);
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Nao foi possivel autorizar o download.' });
  }
}
