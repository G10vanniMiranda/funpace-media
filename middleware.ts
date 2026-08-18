import { next } from '@vercel/functions';

import {
  getMaintenanceHtml,
  getMaintenanceRetryAfter,
  shouldServeMaintenancePage,
} from './server/shared/maintenance';

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const maintenanceMode = process.env.MAINTENANCE_MODE;

  if (!shouldServeMaintenancePage({
    method: request.method,
    pathname: url.pathname,
    maintenanceMode,
  })) {
    return next();
  }

  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; upgrade-insecure-requests",
    'Content-Type': 'text/html; charset=utf-8',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Retry-After': getMaintenanceRetryAfter(),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
  });

  return new Response(request.method === 'HEAD' ? null : getMaintenanceHtml(), {
    status: 503,
    headers,
  });
}

