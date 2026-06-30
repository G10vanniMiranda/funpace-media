import { assertRequestSize, handleOptions as handleSecurityOptions, publicError, rateLimitAsync, rejectUntrustedBrowserOrigin } from '../../server/shared/security.js';

const previewFields = ['thumbnailUrl', 'watermarkUrl'] as const;

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function quotePostgrestString(value: string) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function postgrestIn(values: string[]) {
  return `in.(${values.map(quotePostgrestString).join(',')})`;
}

function isAllowedMediaPath(value: string) {
  if (!value || value.length > 2048 || value.includes('..')) return false;
  if (!/^https?:\/\//i.test(value)) return !value.startsWith('/');

  const mediaBaseUrl = String(process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!mediaBaseUrl) return false;
  return value.startsWith(`${mediaBaseUrl}/`);
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role não configurado.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

function getBearerToken(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; isAdmin: boolean } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;
  const user: any = await response.json().catch(() => null);
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  return user?.id ? { id: String(user.id), isAdmin: role === 'admin' || role === 'super_admin' } : null;
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
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
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || raw || `Supabase HTTP ${response.status}`);
  return data as T;
}

function publicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;

  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, '')}/${encodeURI(rawPathOrUrl.replace(/^\/+/, ''))}`;
  }

  return rawPathOrUrl;
}

async function signedMediaUrl(rawPathOrUrl: string) {
  return publicMediaUrl(rawPathOrUrl);
}

async function loadAllowedPreviewPaths(paths: string[], user: { id: string; isAdmin: boolean } | null) {
  if (paths.length === 0) return new Set<string>();

  const params = new URLSearchParams({
    select: 'id,status,vendedorId,thumbnailUrl,watermarkUrl',
    limit: '1000',
  });
  const inClause = postgrestIn(paths);
  params.set('or', `(${previewFields.map((field) => `${field}.${inClause}`).join(',')})`);

  const rows = await supabaseRequest<any[]>(`/rest/v1/products?${params.toString()}`);
  const allowed = new Set<string>();

  for (const row of rows) {
    const canView = row.status === 'published' || user?.isAdmin || (user?.id && row.vendedorId === user.id);
    if (!canView) continue;

    for (const field of previewFields) {
      const value = String(row[field] || '');
      if (paths.includes(value)) allowed.add(value);
    }
  }

  return allowed;
}

export default async function handler(req: any, res: any) {
  if (handleSecurityOptions(req, res, 'POST,OPTIONS')) return;
  if (await rateLimitAsync(req, res, { keyPrefix: 'media-sign', windowMs: 60 * 1000, max: 45 })) return;
  if (rejectUntrustedBrowserOrigin(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 200 * 1024));
    const body = getJsonBody(req);
    const paths: string[] = Array.isArray(body.paths) ? body.paths.map(String) : [];
    const uniquePaths = Array.from(new Set(paths))
      .filter((path): path is string => isAllowedMediaPath(path))
      .slice(0, 200);
    const authUser = await getAuthenticatedRequestUser(req);
    const allowedPreviewPaths = await loadAllowedPreviewPaths(uniquePaths, authUser);
    const signablePaths = uniquePaths.filter((path) => allowedPreviewPaths.has(path));

    const entries = await Promise.all(
      signablePaths.map(async (path) => [path, await signedMediaUrl(path)] as const),
    );

    return res.status(200).json({ urls: Object.fromEntries(entries) });
  } catch (error: any) {
    const safe = publicError(error, 'Não foi possível assinar mídias.');
    return res.status(safe.statusCode).json({ error: safe.message });
  }
}
