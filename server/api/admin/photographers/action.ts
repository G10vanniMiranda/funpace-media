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

  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Service Role não configurado.');
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

function devLog(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`[photographer-signup] ${message}`, metadata || {});
}

function maskEmail(value: string) {
  return value.replace(/^(.{2}).*(@.*)$/, '$1***$2');
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function logApprovalStep(step: string, metadata: Record<string, unknown>) {
  console.info('[photographer-approval]', { step, ...metadata });
}

async function findAuthUserByEmail(email: string) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  const normalizedEmail = email.trim().toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: '100' });
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?${params.toString()}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });
    const raw = await response.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }

    if (!response.ok) {
      throw new Error(payload?.message || raw || `Supabase Auth HTTP ${response.status}`);
    }

    const users = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
    const user = users.find((item: any) => String(item?.email || '').trim().toLowerCase() === normalizedEmail);
    if (user?.id) return user;
    if (users.length < 100) return null;
  }

  return null;
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) return res.status(403).json({ error: 'Apenas administradores podem alterar fotógrafos.' });

    const { id, action } = getRouteInput(req);
    if (!id) return res.status(400).json({ error: 'ID do fotógrafo é obrigatório.' });

    const [existing] = await supabaseRequest<any[]>(
      `/rest/v1/photographers?id=eq.${encodeURIComponent(id)}&select=id,auth_user_id,name,email,verified,approved,status,isPublic,blockedAt&limit=1`,
    );
    if (!existing) return res.status(404).json({ error: 'Fotógrafo não encontrado.' });

    if (req.method === 'DELETE') {
      await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      return res.json({
        ok: true,
        deletedId: id,
        message: 'Fotógrafo excluído com sucesso.',
      });
    }

    if (action !== 'disable' && action !== 'reactivate' && action !== 'approve') {
      return res.status(400).json({ error: 'Ação inválida para fotógrafo.' });
    }

    const isApprovalAction = action === 'reactivate' || action === 'approve';
    const now = new Date().toISOString();
    let targetId = id;
    let patch: Record<string, unknown> = action === 'disable'
      ? { verified: false, approved: false, status: 'pending', blockedAt: now, updatedAt: now }
      : { verified: true, approved: true, status: 'active', isPublic: true, blockedAt: null, updatedAt: now };

    if (isApprovalAction) {
      logApprovalStep('approval_started', {
        photographerId: existing.id,
        email: maskEmail(String(existing.email || '')),
        hasAuthUserId: Boolean(existing.auth_user_id),
        currentStatus: existing.status,
        verified: Boolean(existing.verified),
        approved: Boolean(existing.approved),
      });

      const authUser = existing.auth_user_id ? { id: existing.auth_user_id, email: existing.email } : await findAuthUserByEmail(existing.email);
      if (!authUser?.id || !isUuid(authUser.id)) {
        logApprovalStep('auth_user_missing', {
          photographerId: existing.id,
          email: maskEmail(String(existing.email || '')),
        });
        return res.status(409).json({
          error: 'Fotografo encontrado, mas nao existe usuario confirmado no Supabase Auth para este e-mail. Peca para o fotografo confirmar/criar a conta antes da aprovacao.',
          code: 'AUTH_USER_MISSING',
        });
      }

      patch = {
        ...patch,
        id: authUser.id,
        auth_user_id: authUser.id,
      };

      logApprovalStep('auth_user_found', {
        photographerId: existing.id,
        authUserId: authUser.id,
        email: maskEmail(String(existing.email || '')),
      });
    }

    const [photographer] = await supabaseRequest<any[]>(
      `/rest/v1/photographers?id=eq.${encodeURIComponent(targetId)}&select=*`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      },
    );
    if (!photographer) return res.status(404).json({ error: 'Fotógrafo não encontrado.' });

    if (isApprovalAction) {
      await supabaseRequest(`/rest/v1/photographer_referrals?referredPhotographerId=eq.${encodeURIComponent(id)}&status=eq.pending`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'approved',
          approvedAt: new Date().toISOString(),
        }),
      }).catch((error) => devLog('Nao foi possivel aprovar indicacao do fotografo', { photographerId: id, error: String(error?.message || error) }));
      logApprovalStep('approval_completed', {
        previousPhotographerId: id,
        photographerId: photographer.id,
        authUserId: photographer.auth_user_id,
        verified: Boolean(photographer.verified),
        approved: Boolean(photographer.approved),
        status: photographer.status,
      });
    }

    return res.json({
      ok: true,
      photographer,
      message: action === 'disable' ? 'Fotógrafo desativado com sucesso.' : 'Fotógrafo reativado com sucesso.',
    });
  } catch (error: any) {
    console.error('Erro ao alterar fotógrafo pelo admin:', error);
    return res.status(500).json({ error: error?.message || 'Não foi possível concluir a operação.' });
  }
}
