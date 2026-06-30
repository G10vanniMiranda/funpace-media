import crypto from 'crypto';
import { assertRequestSize, getClientIp, handleOptions as handleSecurityOptions, publicError, rateLimitAsync, rejectUntrustedBrowserOrigin } from '../../server/shared/security.js';

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
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
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
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
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

function onlyInstagramHandle(value: string | null | undefined) {
  return String(value ?? '').trim().replace(/^@+/, '').toLowerCase();
}

function isValidInstagramHandle(value: string | null | undefined) {
  const handle = onlyInstagramHandle(value);
  return handle.length >= 1 && handle.length <= 30 && /^[a-z0-9._]+$/.test(handle);
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

function normalizeReferralCode(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function createSlug(value: string) {
  return normalizeReferralCode(value).slice(0, 72) || `fotografo-${Date.now().toString(36)}`;
}

function devLog(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`[photographer-signup] ${message}`, metadata || {});
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Service Role não configurado na Vercel.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

async function registerPendingReferral(input: {
  referralCode?: string | null;
  referredPhotographerId: string;
  referredEmail: string;
  referredCpf: string;
  referredPhone: string;
  ipHash: string | null;
  userAgent: string | null;
}) {
  const code = normalizeReferralCode(input.referralCode);
  if (!code) return;

  const referrers = await supabaseRequest<any[]>(
    `/rest/v1/photographers?select=id,email,cpf,phone,referralCode,username,slug&or=(referralCode.eq.${encodeURIComponent(code)},username.eq.${encodeURIComponent(code)},slug.eq.${encodeURIComponent(code)})&verified=eq.true&limit=1`,
  ).catch(() => []);
  const referrer = referrers[0];
  if (!referrer?.id || referrer.id === input.referredPhotographerId) return;

  const sameEmail = String(referrer.email || '').toLowerCase() === input.referredEmail.toLowerCase();
  const sameCpf = referrer.cpf && String(referrer.cpf) === input.referredCpf;
  const samePhone = referrer.phone && String(referrer.phone).replace(/\D/g, '') === input.referredPhone;
  if (sameEmail || sameCpf || samePhone) return;

  const created = await supabaseRequest<any[]>('/rest/v1/photographer_referrals?on_conflict=referredPhotographerId&select=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      referrerPhotographerId: referrer.id,
      referredPhotographerId: input.referredPhotographerId,
      referralCode: code,
      status: 'pending',
      rewardAmount: 0,
      rewardStatus: 'none',
      audit: {
        referredEmail: input.referredEmail,
        referredCpf: input.referredCpf,
        referredPhone: input.referredPhone,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
      },
    }),
  }).catch(() => [] as any[]);

  await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(input.referredPhotographerId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      referredByPhotographerId: referrer.id,
      referral_id: created?.[0]?.id || null,
      invited_by: referrer.id,
    }),
  }).catch(() => undefined);
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
  instagram: string;
  bio: string;
  phone: string;
  avatar: string;
  cpf: string;
}) {
  const baseSlug = createSlug(input.instagram || input.name || input.email);
  const slug = `${baseSlug}-${crypto.createHash('sha1').update(input.email).digest('hex').slice(0, 6)}`.slice(0, 80);
  const isAuthUserId = Boolean(input.id && !input.id.startsWith('pending:'));
  return {
    ...(input.id ? { id: input.id } : {}),
    auth_user_id: isAuthUserId ? input.id : null,
    name: input.name,
    displayName: input.name,
    username: slug,
    slug,
    isPublic: false,
    instagram: input.instagram,
    email: input.email,
    bio: input.bio,
    phone: input.phone,
    avatar: input.avatar,
    cpf: input.cpf,
    verified: false,
    approved: false,
    status: 'pending',
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
  instagram: string;
  bio: string;
  phone: string;
  avatar: string;
  cpf: string;
}) {
  const baseSlug = createSlug(input.instagram || input.name || input.email);
  const slug = `${baseSlug}-${crypto.createHash('sha1').update(input.email).digest('hex').slice(0, 6)}`.slice(0, 80);
  return {
    name: input.name,
    displayName: input.name,
    username: slug,
    slug,
    isPublic: false,
    instagram: input.instagram,
    email: input.email,
    bio: input.bio,
    phone: input.phone,
    avatar: input.avatar,
    cpf: input.cpf,
    approved: false,
    status: 'pending',
  };
}

export default async function handler(req: any, res: any) {
  if (handleSecurityOptions(req, res, 'GET,POST,OPTIONS')) return;
  if (await rateLimitAsync(req, res, { keyPrefix: 'photographer-request', windowMs: 60 * 1000, max: 20 })) return;
  if (rejectUntrustedBrowserOrigin(req, res)) return;

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
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  let step = 'inicio';

  try {
    step = 'parse_body';
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 200 * 1024));
    const { userId, email, name, instagram, bio, cpf, phone, avatar, referralCode } = getJsonBody(req);
    devLog('Cadastro iniciado', { email, hasUserId: Boolean(userId), hasReferralCode: Boolean(referralCode) });

    step = 'validacao';
    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Nome invalido.' });
    }

    const phoneDigits = onlyPhoneDigits(typeof phone === 'string' ? phone : '');
    if (!phoneDigits || phoneDigits.length < 10) {
      return res.status(400).json({ error: 'Telefone válido é obrigatório para cadastro de fotógrafo.' });
    }

    const cpfDigits = onlyCpfDigits(typeof cpf === 'string' ? cpf : '');
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return res.status(400).json({ error: 'CPF válido é obrigatório para cadastro de fotógrafo.' });
    }

    const instagramHandle = onlyInstagramHandle(typeof instagram === 'string' ? instagram : '');
    if (!isValidInstagramHandle(instagramHandle)) {
      return res.status(400).json({ error: 'Instagram válido é obrigatório para cadastro de fotógrafo.' });
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
        return res.status(409).json({ error: 'Este e-mail já pertence a um fotógrafo aprovado.' });
      }

      await supabaseRequest(`/rest/v1/photographers?email=eq.${encodeURIComponent(normalizedEmail)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(photographerUpdatePayload({
          name: name.trim(),
          email: normalizedEmail,
          instagram: `@${instagramHandle}`,
          bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
          phone: phoneDigits,
          avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
          cpf: cpfDigits,
        })),
      });
      devLog('Photographer pendente atualizado', { id: existingByEmail[0]?.id, email: normalizedEmail });
    } else {
      try {
        await supabaseRequest('/rest/v1/photographers', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(photographerPayload({
            id: resolvedId,
            name: name.trim(),
            email: normalizedEmail,
            instagram: `@${instagramHandle}`,
            bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
            phone: phoneDigits,
            avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
            cpf: cpfDigits,
          })),
        });
        devLog('Photographer criado como pending', { id: resolvedId, email: normalizedEmail });
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
            instagram: `@${instagramHandle}`,
            bio: typeof bio === 'string' ? bio.slice(0, 1000) : '',
            phone: phoneDigits,
            avatar: typeof avatar === 'string' ? avatar.slice(0, 2048) : '',
            cpf: cpfDigits,
          })),
        });
        devLog('Photographer pendente atualizado apos conflito de email', { id: resolvedId, email: normalizedEmail });
      }
    }

    await registerPendingReferral({
      referralCode,
      referredPhotographerId: resolvedId,
      referredEmail: normalizedEmail,
      referredCpf: cpfDigits,
      referredPhone: phoneDigits,
      ipHash: crypto.createHash('sha256').update(getClientIp(req)).digest('hex'),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    });
    devLog('Referral registrada e status pending confirmado', { id: resolvedId, referralCode: normalizeReferralCode(referralCode) || null });

    return res.status(200).json({ ok: true, id: resolvedId });
  } catch (error: any) {
    const safe = publicError(error, 'Erro ao registrar fotógrafo pendente.');
    return res.status(safe.statusCode).json({
      error: safe.message,
      source: 'photographers-request',
      step,
    });
  }
}
