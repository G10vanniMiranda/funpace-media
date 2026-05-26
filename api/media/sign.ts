const mediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER || 'supabase';
const mediaBucket = process.env.MEDIA_BUCKET || process.env.BUCKET || '';

function usesExternalBucket() {
  return mediaStorageProvider === 'external_bucket' || Boolean(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN);
}

function setCors(req: any, res: any) {
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');

  if (origin && origins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl) throw new Error('SUPABASE_URL nao configurado.');

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

function assertMediaBucketConfigured() {
  if (!mediaBucket) {
    throw new Error('MEDIA_BUCKET nao configurado no servidor.');
  }
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

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const body = getJsonBody(req);
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
    const uniquePaths = Array.from(new Set(paths)).filter((path): path is string => Boolean(path)).slice(0, 200);

    const entries = await Promise.all(
      uniquePaths.map(async (path) => [path, await signedMediaUrl(path)] as const),
    );

    return res.status(200).json({ urls: Object.fromEntries(entries) });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Nao foi possivel assinar midias.' });
  }
}
