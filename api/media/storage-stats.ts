const mediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER || 'supabase';
const mediaBucket = process.env.MEDIA_BUCKET || process.env.BUCKET || '';
const externalBucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/api').replace(/\/+$/, '');
const externalBucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '';

function usesExternalBucket() {
  return mediaStorageProvider === 'external_bucket' || Boolean(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN);
}

function getStorageQuotaBytes() {
  return Number(process.env.BUCKET_STORAGE_QUOTA_BYTES || 250 * 1024 * 1024 * 1024);
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

function getBearerToken(req: any) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedAdminUser(req: any): Promise<{ id: string } | null> {
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
  return user?.app_metadata?.role === 'admin' && user?.id ? { id: String(user.id) } : null;
}

function cleanProviderErrorMessage(raw: string, fallback: string) {
  const decoded = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim();

  if (/sess[aã]o expirada/i.test(decoded)) {
    return 'Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.';
  }

  return decoded || fallback;
}

async function getExternalBucketStorageStats() {
  if (!externalBucketToken) throw new Error('BUCKET_API_TOKEN nao configurado no servidor.');
  if (!mediaBucket) throw new Error('MEDIA_BUCKET nao configurado no servidor.');

  const response = await fetch(`${externalBucketApiBaseUrl}/files?bucket=${encodeURIComponent(mediaBucket)}`, {
    headers: {
      'X-API-Token': externalBucketToken,
    },
  });
  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const providerMessage = payload?.error || payload?.message || payload?.raw || raw;
    throw new Error(cleanProviderErrorMessage(String(providerMessage || ''), `Consulta do bucket falhou com status ${response.status}.`));
  }

  const files = Array.isArray(payload?.files) ? payload.files : [];
  const activeFiles = files.filter((file: any) => !file?.deleted_at && file?.status !== 'deleted' && file?.storage_exists !== false);
  const usedBytes = activeFiles.reduce((sum: number, file: any) => sum + Number(file?.size_bytes || file?.size || 0), 0);
  const quotaBytes = getStorageQuotaBytes();
  const byType = activeFiles.reduce((acc: Record<string, { count: number; bytes: number }>, file: any) => {
    const key = String(file?.file_type || file?.mime_type || file?.extension || 'outros').toLowerCase();
    const current = acc[key] ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += Number(file?.size_bytes || file?.size || 0);
    acc[key] = current;
    return acc;
  }, {});

  return {
    bucket: mediaBucket,
    usedBytes,
    quotaBytes,
    usagePercent: quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0,
    totalFiles: activeFiles.length,
    byType,
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser?.id) {
      return res.status(401).json({ error: 'Acesso admin necessario para consultar storage.' });
    }

    if (!usesExternalBucket()) {
      throw new Error('MEDIA_STORAGE_PROVIDER deve ser external_bucket para consultar storage.');
    }

    return res.status(200).json(await getExternalBucketStorageStats());
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Nao foi possivel consultar storage.' });
  }
}
