type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  windowMs: number;
  max: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __funpaceRateLimitBuckets: Map<string, RateLimitBucket> | undefined;
  // eslint-disable-next-line no-var
  var __funpaceRateLimitCleanupCounter: number | undefined;
}

const defaultOrigins = [
  'https://funpace.media',
  'https://www.funpace.media',
];

function getConfiguredOrigins() {
  return new Set([
    ...defaultOrigins,
    process.env.FRONTEND_URL,
    process.env.VITE_FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
}

export function getClientIp(req: any) {
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim() ||
    String(req.headers?.['x-real-ip'] || '') ||
    String(req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown');
}

export function setSecurityHeaders(res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Origin-Agent-Cluster', '?1');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

export function setCors(req: any, res: any, methods = 'GET,POST,OPTIONS', headers = 'Content-Type, Authorization') {
  setSecurityHeaders(res);
  const origin = String(req.headers?.origin || '').replace(/\/+$/, '');
  if (origin && getConfiguredOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Access-Control-Max-Age', '600');
}

export function isTrustedBrowserOrigin(req: any) {
  const allowedOrigins = getConfiguredOrigins();
  const origin = String(req.headers?.origin || '').replace(/\/+$/, '');
  if (origin) return allowedOrigins.has(origin);

  try {
    const refererOrigin = new URL(String(req.headers?.referer || '')).origin.replace(/\/+$/, '');
    return !refererOrigin || allowedOrigins.has(refererOrigin);
  } catch {
    return true;
  }
}

export function rejectUntrustedBrowserOrigin(req: any, res: any) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (isTrustedBrowserOrigin(req)) return false;
  res.status(403).json({ error: 'Origem não autorizada.' });
  return true;
}

function rateLimitBuckets() {
  if (!globalThis.__funpaceRateLimitBuckets) {
    globalThis.__funpaceRateLimitBuckets = new Map();
  }
  return globalThis.__funpaceRateLimitBuckets;
}

function cleanupRateLimitBuckets(buckets: Map<string, RateLimitBucket>, now: number) {
  globalThis.__funpaceRateLimitCleanupCounter = (globalThis.__funpaceRateLimitCleanupCounter || 0) + 1;
  if (buckets.size < 10_000 && globalThis.__funpaceRateLimitCleanupCounter % 256 !== 0) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(req: any, res: any, options: RateLimitOptions) {
  const now = Date.now();
  const key = `${options.keyPrefix}:${getClientIp(req)}`;
  const buckets = rateLimitBuckets();
  cleanupRateLimitBuckets(buckets, now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return false;
  }

  bucket.count += 1;
  if (bucket.count <= options.max) return false;

  res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
  res.status(429).json({ error: 'Muitas tentativas. Aguarde e tente novamente.' });
  return true;
}

export function assertRequestSize(req: any, maxBytes: number) {
  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw Object.assign(new Error('Payload maior que o limite permitido.'), { statusCode: 413 });
  }

  if (typeof req.body === 'string' && Buffer.byteLength(req.body, 'utf8') > maxBytes) {
    throw Object.assign(new Error('Payload maior que o limite permitido.'), { statusCode: 413 });
  }

  if (req.body && typeof req.body === 'object') {
    const size = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
    if (size > maxBytes) {
      throw Object.assign(new Error('Payload maior que o limite permitido.'), { statusCode: 413 });
    }
  }
}

export function handleOptions(req: any, res: any, methods?: string, headers?: string) {
  setCors(req, res, methods, headers);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function publicError(error: any, fallback: string) {
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode === 413) return { statusCode, message: error?.message || 'Payload maior que o limite permitido.' };
  if (statusCode >= 400 && statusCode < 500) return { statusCode, message: error?.message || fallback };
  return { statusCode: 500, message: fallback };
}
