function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getBearerToken(req: any) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Service Role nao configurado.');
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey, anonKey };
}

async function getAuthenticatedAdminUser(req: any) {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin' ? user : null;
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) throw new Error(data?.message || data?.hint || raw || `Supabase HTTP ${response.status}`);
  return data as T;
}

function getRouteInput(req: any) {
  const idFromQuery = String(req.query?.id || '').trim();
  const actionFromQuery = String(req.query?.action || '').trim();
  if (idFromQuery) return { id: idFromQuery, action: actionFromQuery };

  const pathname = String(req.url || '').split('?')[0] || '';
  const match = pathname.match(/\/api\/admin\/photographers\/([^/]+)(?:\/([^/]+))?$/);
  return {
    id: match?.[1] ? decodeURIComponent(match[1]) : '',
    action: match?.[2] ? decodeURIComponent(match[2]) : '',
  };
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) return res.status(403).json({ error: 'Apenas administradores podem alterar fotografos.' });

    const { id, action } = getRouteInput(req);
    if (!id) return res.status(400).json({ error: 'ID do fotografo e obrigatorio.' });

    const [existing] = await supabaseRequest<any[]>(
      `/rest/v1/photographers?id=eq.${encodeURIComponent(id)}&select=id,name,email,verified,blockedAt&limit=1`,
    );
    if (!existing) return res.status(404).json({ error: 'Fotografo nao encontrado.' });

    if (req.method === 'DELETE') {
      await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      return res.json({
        ok: true,
        deletedId: id,
        message: 'Fotografo excluido com sucesso.',
      });
    }

    if (action !== 'disable' && action !== 'reactivate') {
      return res.status(400).json({ error: 'Acao invalida para fotografo.' });
    }

    const patch = action === 'disable'
      ? { verified: false, blockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      : { verified: true, blockedAt: null, updatedAt: new Date().toISOString() };

    const [photographer] = await supabaseRequest<any[]>(
      `/rest/v1/photographers?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      },
    );
    if (!photographer) return res.status(404).json({ error: 'Fotografo nao encontrado.' });

    return res.json({
      ok: true,
      photographer,
      message: action === 'disable' ? 'Fotografo desativado com sucesso.' : 'Fotografo reativado com sucesso.',
    });
  } catch (error: any) {
    console.error('Erro ao alterar fotografo pelo admin:', error);
    return res.status(500).json({ error: error?.message || 'Nao foi possivel concluir a operacao.' });
  }
}
