import { timingSafeEqual } from 'node:crypto';

function bearerToken(req: any) {
  return String(req.headers?.authorization || req.headers?.Authorization || '')
    .match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim() || '';
}

function isBackfillRoute(req: any) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST') return false;
  const path = String(req.path || req.url || '').split('?')[0].replace(/\/+$/, '');
  const baseUrl = String(req.baseUrl || '').replace(/\/+$/, '');
  const fullPath = `${baseUrl}${path === '/' ? '' : path}`;
  const route = String(req.query?.route || '').trim();
  if (route === 'backfill' && (path === '/api/face' || fullPath === '/api/face')) return true;
  return path === '/api/face/backfill' || fullPath === '/api/face/backfill';
}

function secretsMatch(token: string, secret: string) {
  if (!token || !secret) return false;
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  return tokenBuffer.length === secretBuffer.length && timingSafeEqual(tokenBuffer, secretBuffer);
}

export function shouldBypassFaceBackfillRateLimit(req: any) {
  if (!isBackfillRoute(req)) return false;
  return secretsMatch(bearerToken(req), String(process.env.OPERATIONS_SECRET || ''));
}
