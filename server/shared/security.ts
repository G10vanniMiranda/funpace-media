// Shared security primitives for Vercel functions and the Express-compatible backend.
import { ensureRequestId, logEvent } from './observability.js';
type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  windowMs: number;
  max: number;
  onLimit?: (retryAfterSeconds: number) => void;
};

type RateLimitDecision = {
  limited: boolean;
  retryAfterSeconds: number;
  store: 'memory' | 'upstash';
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
  const requestId = ensureRequestId(req, res);
  logEvent('warn', 'browser_origin_blocked', {
    requestId,
    method,
    path: req.url || req.originalUrl || null,
    origin: req.headers?.origin || null,
    referer: req.headers?.referer || null,
  });
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

function getDistributedRateLimitConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || process.env.RATE_LIMIT_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.RATE_LIMIT_REDIS_REST_TOKEN || '');
  return url && token ? { url, token } : null;
}

function rateLimitKey(options: RateLimitOptions, req: any) {
  return `funpace:rate-limit:${options.keyPrefix}:${getClientIp(req)}`.replace(/[^a-zA-Z0-9:._-]/g, '_');
}

function readUpstashResult(entry: any) {
  return Number(entry?.result ?? entry?.[0] ?? entry ?? 0);
}

async function checkDistributedRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitDecision | null> {
  const config = getDistributedRateLimitConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['PEXPIRE', key, options.windowMs, 'NX'],
      ['PTTL', key],
    ]),
  });

  if (!response.ok) {
    throw new Error(`Upstash rate limit HTTP ${response.status}`);
  }

  const payload: any = await response.json();
  const count = readUpstashResult(payload?.[0]);
  const ttlMs = Math.max(0, readUpstashResult(payload?.[2]));
  return {
    limited: count > options.max,
    retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    store: 'upstash',
  };
}

function checkMemoryRateLimit(req: any, options: RateLimitOptions): RateLimitDecision {
  const now = Date.now();
  const key = rateLimitKey(options, req);
  const buckets = rateLimitBuckets();
  cleanupRateLimitBuckets(buckets, now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { limited: false, retryAfterSeconds: 0, store: 'memory' };
  }

  bucket.count += 1;
  if (bucket.count <= options.max) return { limited: false, retryAfterSeconds: 0, store: 'memory' };

  const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
  return { limited: true, retryAfterSeconds, store: 'memory' };
}

function respondRateLimited(req: any, res: any, options: RateLimitOptions, decision: RateLimitDecision) {
  const requestId = ensureRequestId(req, res);
  logEvent('warn', 'rate_limit_exceeded', {
    requestId,
    keyPrefix: options.keyPrefix,
    store: decision.store,
    method: req.method || null,
    path: req.url || req.originalUrl || null,
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  res.setHeader('Retry-After', String(decision.retryAfterSeconds));
  if (options.onLimit) {
    options.onLimit(decision.retryAfterSeconds);
    return true;
  }
  res.status(429).json({ error: 'Muitas tentativas. Aguarde e tente novamente.' });
  return true;
}

export function rateLimit(req: any, res: any, options: RateLimitOptions) {
  const decision = checkMemoryRateLimit(req, options);
  return decision.limited ? respondRateLimited(req, res, options, decision) : false;
}

export async function rateLimitAsync(req: any, res: any, options: RateLimitOptions) {
  let decision: RateLimitDecision | null = null;
  try {
    decision = await checkDistributedRateLimit(rateLimitKey(options, req), options);
  } catch (error) {
    logEvent('warn', 'distributed_rate_limit_failed', {
      requestId: ensureRequestId(req, res),
      keyPrefix: options.keyPrefix,
      error: error instanceof Error ? error.message : String(error || 'unknown_error'),
    });
  }

  decision = decision ?? checkMemoryRateLimit(req, options);
  return decision.limited ? respondRateLimited(req, res, options, decision) : false;
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
  ensureRequestId(req, res);
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
