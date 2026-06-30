import crypto from 'crypto';

type LogLevel = 'info' | 'warn' | 'error';

const requestIdHeader = 'X-Request-ID';
const sensitiveKeyPattern = /authorization|cookie|password|secret|token|cpf|document|rawresponse|payload/i;

function sanitizeRequestId(value: unknown) {
  const requestId = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(requestId) ? requestId : '';
}

export function createRequestId(prefix = 'req') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function getRequestId(req: any) {
  return sanitizeRequestId(req?.requestId || req?.headers?.['x-request-id'] || req?.headers?.['X-Request-ID']);
}

export function ensureRequestId(req: any, res?: any, prefix = 'req') {
  const requestId = getRequestId(req) || createRequestId(prefix);
  if (req) req.requestId = requestId;
  if (res?.setHeader && !res.headersSent) res.setHeader(requestIdHeader, requestId);
  return requestId;
}

export function errorToLog(error: any) {
  return {
    name: error?.name || 'Error',
    message: error instanceof Error ? error.message : String(error || 'erro desconhecido'),
    statusCode: Number(error?.statusCode || error?.status || 500),
  };
}

function redact(value: unknown): unknown {
  if (value instanceof Error) return errorToLog(value);
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    sensitiveKeyPattern.test(key) ? '[redacted]' : redact(entry),
  ]));
}

export function logEvent(level: LogLevel, event: string, detail: Record<string, unknown> = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(redact(detail) as Record<string, unknown>),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}
