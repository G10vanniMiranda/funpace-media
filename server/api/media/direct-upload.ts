import { createClient } from '@supabase/supabase-js';
import { assertRequestSize, publicError, setSecurityHeaders } from '../../shared/security.js';

const mediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER || 'supabase';
const mediaBucket = process.env.MEDIA_BUCKET || process.env.SUPABASE_BUCKET || process.env.BUCKET || '';

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurado.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

function getSupabaseAuthApiKey() {
  return process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    getSupabaseConfig().supabaseKey;
}

function getBearerToken(req: any) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl } = getSupabaseConfig();
  const authApiKey = getSupabaseAuthApiKey();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: authApiKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

async function assertVerifiedPhotographer(userId: string) {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/photographers?select=id,verified&id=eq.${encodeURIComponent(userId)}&limit=1`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.some((row) => row?.id === userId && row?.verified === true);
}

function isSafeStoragePath(path: string, userId: string) {
  if (!path || path.length > 512 || path.includes('..') || path.startsWith('/')) return false;
  if (!path.startsWith(`${userId}/`)) return false;
  return /^[a-zA-Z0-9._/-]+$/.test(path);
}

function createPublicMediaUrl(path: string) {
  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, '')}/${encodeURI(path.replace(/^\/+/, ''))}`;
  }

  const { supabaseUrl } = getSupabaseConfig();
  return `${supabaseUrl}/storage/v1/object/public/${mediaBucket}/${encodeURI(path)}`;
}

function assertSupabaseDirectUploadEnabled() {
  const usesExternalBucket = mediaStorageProvider === 'external_bucket' || Boolean(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN);
  if (usesExternalBucket) {
    throw Object.assign(new Error('Upload direto nao disponivel para external_bucket.'), { statusCode: 409 });
  }
  if (!mediaBucket) {
    throw new Error('MEDIA_BUCKET nao configurado no servidor.');
  }
}

export default async function directUploadHandler(req: any, res: any) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 200 * 1024));
    assertSupabaseDirectUploadEnabled();

    const authUser = await getAuthenticatedRequestUser(req);
    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente no painel para enviar arquivos.' });
    }
    if (!(await assertVerifiedPhotographer(authUser.id))) {
      return res.status(403).json({ error: 'Apenas fotografos aprovados podem enviar midias.' });
    }

    const body = getJsonBody(req);
    const path = String(body.path || '').trim();
    if (!isSafeStoragePath(path, authUser.id)) {
      return res.status(403).json({ error: 'Caminho de upload invalido para este fotografo.' });
    }

    const { supabaseUrl, supabaseKey } = getSupabaseConfig();
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.storage.from(mediaBucket).createSignedUploadUrl(path, {
      upsert: false,
    });
    if (error || !data?.signedUrl || !data?.token) {
      throw new Error(error?.message || 'Nao foi possivel criar URL assinada de upload.');
    }

    return res.status(200).json({
      provider: 'supabase',
      bucket: mediaBucket,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: createPublicMediaUrl(path),
    });
  } catch (error: any) {
    const safe = publicError(error, 'Nao foi possivel preparar upload direto.');
    return res.status(safe.statusCode).json({ error: safe.message });
  }
}
