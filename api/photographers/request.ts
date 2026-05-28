function setCors(req: any, res: any) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

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

function isTrustedOrigin(req: any) {
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin) return origins.has(origin);

  try {
    const refererOrigin = new URL(String(req.headers.referer || '')).origin.replace(/\/+$/, '');
    return !refererOrigin || origins.has(refererOrigin);
  } catch {
    return true;
  }
}

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function onlyCpfDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '').slice(0, 11);
}

function onlyPhoneDigits(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  const withoutCountry = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  return withoutCountry.slice(0, 11);
}

function isValidCpf(value: string | null | undefined) {
  const cpf = onlyCpfDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (baseLength: number) => {
    let sum = 0;
    for (let i = 0; i < baseLength; i += 1) {
      sum += Number(cpf[i]) * (baseLength + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calcDigit(9) === Number(cpf[9]) && calcDigit(10) === Number(cpf[10]);
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role nao configurado na Vercel.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
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
  let data: any = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || data?.hint || raw;
    throw new Error(message || `Erro Supabase HTTP ${response.status}`);
  }

  return data as T;
}

function photographerPayload(input: {
  id?: string;
  name: string;
  email: string;
  bio: string;
  phone: string;
  avatar: string;
  cpf: string;
}) {
  return {
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    email: input.email,
    bio: input.bio,
    phone: input.phone,
    avatar: input.avatar,
    cpf: input.cpf,
    verified: false,
    stats: {
      photos: 0,
      events: 0,
      rating: 5,
      totalEarnings: 0,
      pendingEarnings: 0,
      salesCount: 0,
    },
  };
}

function photographerUpdatePayload(input: {
  name: string;
  email: string;
  bio: string;
  phone: string;
  avatar: string;
  cpf: string;
}) {
  return {
    name: input.name,
    email: input.email,
    bio: input.bio,
    phone: input.phone,
    avatar: input.avatar,
    cpf: input.cpf,
  };
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ error: 'Origem nao autorizada.' });
  }

  if (req.method === 'GET') {
    if (process.env.ENABLE_PUBLIC_DIAGNOSTICS !== 'true') {
      return res.status(404).json({ error: 'Endpoint indisponivel.' });
    }

    return res.status(200).json({
      ok: true,
      env: {
        SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY),
      },
      time: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  let step = 'inicio';

  try {
    step = 'parse_body';
    const { userId, email, name, bio, cpf, phone, avatar } = getJsonBody(req);

    step = 'validacao';
    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Nome invalido.' });
    }

    const phoneDigits = onlyPhoneDigits(typeof phone === 'string' ? phone : '');
    if (!phoneDigits || phoneDigits.length < 10) {
      return res.status(400).json({ error: 'Telefone valido e obrigatorio para cadastro de fotografo.' });
    }

    const cpfDigits = onlyCpfDigits(typeof cpf === 'string' ? cpf : '');
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return res.status(400).json({ error: 'CPF valido e obrigatorio para cadastro de fotografo.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    step = 'buscar_por_email';
    const emailParams = new URLSearchParams({
      select: 'id,verified',
      email: `eq.${normalizedEmail}`,
      limit: '1',
    });
    const existingByEmail = await supabaseRequest<any[]>(
      `/rest/v1/photographers?${emailParams.toString()}`,
    );
    const resolvedId = existingByEmail[0]?.id ||
      (typeof userId === 'string' && userId.trim().length >= 8 ? userId.trim() : `pending:${normalizedEmail}`);

    step = 'gravar_fotografo';
    if (existingByEmail[0]?.id) {
      if (existingByEmail[0]?.verified) {
        return res.status(409).json({ error: 'Este e-mail ja pertence a um fotografo aprovado.' });
      }

      await supabaseRequest(`/rest/v1/photographers?email=eq.${encodeURIComponent(normalizedEmail)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(photographerUpdatePayload({
          name: name.trim(),
          email: normalizedEmail,
          bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
          phone: phoneDigits,
          avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
          cpf: cpfDigits,
        })),
      });
    } else {
      try {
        await supabaseRequest('/rest/v1/photographers', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(photographerPayload({
            id: resolvedId,
            name: name.trim(),
            email: normalizedEmail,
            bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
            phone: phoneDigits,
            avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
            cpf: cpfDigits,
          })),
        });
      } catch (insertError: any) {
        if (!String(insertError?.message || '').includes('photographers_email_key')) {
          throw insertError;
        }

        await supabaseRequest(`/rest/v1/photographers?email=eq.${encodeURIComponent(normalizedEmail)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(photographerUpdatePayload({
            name: name.trim(),
            email: normalizedEmail,
            bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
            phone: phoneDigits,
            avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
            cpf: cpfDigits,
          })),
        });
      }
    }

    return res.status(200).json({ ok: true, id: resolvedId });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Erro ao registrar fotografo pendente.',
      source: 'photographers-request',
      step,
    });
  }
}
