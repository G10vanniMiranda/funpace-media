const mediaBucket = process.env.SUPABASE_BUCKET || process.env.BUCKET || 'funpace-media';

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

function extractStoragePath(value: string) {
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');

  try {
    const parsed = new URL(value);
    const publicMarker = `/storage/v1/object/public/${mediaBucket}/`;
    const signedMarker = `/storage/v1/object/sign/${mediaBucket}/`;
    const marker = parsed.pathname.includes(publicMarker) ? publicMarker : signedMarker;
    const index = parsed.pathname.indexOf(marker);
    return index === -1 ? '' : decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return '';
  }
}

function publicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;
  const { supabaseUrl } = getSupabaseConfig();
  const path = extractStoragePath(rawPathOrUrl);
  return path ? `${supabaseUrl}/storage/v1/object/public/${mediaBucket}/${encodeURI(path)}` : rawPathOrUrl;
}

async function signedMediaUrl(rawPathOrUrl: string) {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const path = extractStoragePath(rawPathOrUrl);
  if (!path || !supabaseKey) return publicMediaUrl(rawPathOrUrl);

  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${mediaBucket}/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 900 }),
  });

  if (!response.ok) return publicMediaUrl(rawPathOrUrl);

  const payload: any = await response.json().catch(() => ({}));
  const signedPath = payload?.signedURL || payload?.signedUrl || payload?.url || '';
  return signedPath && signedPath.startsWith('http') ? signedPath : `${supabaseUrl}${signedPath}`;
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
