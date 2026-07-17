import { getIntegrityDashboard, runIntegrityScan, updateReviewItem } from '../../integrity/integrity-service.js';

function setCors(req: any, res: any) {
  const origins = new Set([
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function getBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

async function getAdmin(req: any) {
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !apiKey) throw new Error('Supabase não configurado para autenticação administrativa.');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const user: any = await response.json().catch(() => null);
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  return user?.id && (role === 'admin' || role === 'super_admin') ? user : null;
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const admin = await getAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Acesso admin não autorizado.' });
    const url = String(req.url || '');
    if (req.method === 'GET') return res.status(200).json(await getIntegrityDashboard());
    if (req.method === 'POST' && (url.includes('/run') || req.query?.action === 'run')) {
      const body = getBody(req);
      const result = await runIntegrityScan({ reconcile: body.reconcile === true, triggerSource: 'admin_manual', actorId: admin.id });
      return res.status(200).json(result);
    }
    if (req.method === 'PATCH' && (url.includes('/review/') || req.query?.action === 'review')) {
      const body = getBody(req);
      const id = String(req.params?.id || req.query?.id || '').trim();
      if (!id || !['approved', 'rejected'].includes(body.status)) return res.status(400).json({ error: 'ID e decisão válidos são obrigatórios.' });
      return res.status(200).json(await updateReviewItem({ id, status: body.status, reviewerId: admin.id, note: body.note }));
    }
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Falha no serviço de integridade.' });
  }
}
