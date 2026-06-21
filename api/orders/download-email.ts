import { assertRequestSize, handleOptions, publicError, rateLimit, rejectUntrustedBrowserOrigin } from '../_security.js';
import { sendPaidOrderEmail } from '../../server/shared/checkoutFulfillment.js';
import { getSupabaseApiConfig, supabaseRequest } from '../../server/shared/utils.js';

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function getBearerToken(req: any) {
  const match = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedUser(req: any): Promise<{ id: string; email: string | null; role: string }> {
  const token = getBearerToken(req);
  if (!token) throw Object.assign(new Error('Entre novamente para reenviar o e-mail.'), { statusCode: 401 });

  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) throw Object.assign(new Error('Sessao expirada.'), { statusCode: 401 });
  const user: any = await response.json().catch(() => null);
  if (!user?.id) throw Object.assign(new Error('Sessao invalida.'), { statusCode: 401 });
  return {
    id: String(user.id),
    email: user.email ? String(user.email).toLowerCase() : null,
    role: String(user.app_metadata?.role || '').toLowerCase(),
  };
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res, 'POST,OPTIONS')) return;
  if (rateLimit(req, res, { keyPrefix: 'download-email', windowMs: 60 * 1000, max: 20 })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido.' });
  if (rejectUntrustedBrowserOrigin(req, res)) return;

  try {
    assertRequestSize(req, Number(process.env.API_JSON_BODY_LIMIT_BYTES || 64 * 1024));
    const body = getJsonBody(req);
    const orderId = String(body.orderId || '').trim();
    if (!isUuid(orderId)) throw Object.assign(new Error('Pedido invalido.'), { statusCode: 400 });

    const authUser = await getAuthenticatedUser(req);
    const isAdmin = authUser.role === 'admin' || authUser.role === 'super_admin';

    const [order] = await supabaseRequest<any[]>(
      `/rest/v1/orders?select=id,userId,buyerEmail,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    if (!order) throw Object.assign(new Error('Pedido nao encontrado.'), { statusCode: 404 });
    if (order.status !== 'paid') throw Object.assign(new Error('O e-mail de download so pode ser reenviado para pedidos pagos.'), { statusCode: 409 });

    const buyerEmail = String(order.buyerEmail || '').toLowerCase();
    const ownsOrder = order.userId === authUser.id || (authUser.email && buyerEmail === authUser.email);
    if (!isAdmin && !ownsOrder) {
      throw Object.assign(new Error('Este pedido nao pertence ao usuario logado.'), { statusCode: 403 });
    }

    const result = await sendPaidOrderEmail(orderId, {
      force: true,
      actor: isAdmin ? 'admin' : 'customer',
    });

    if ((result as any)?.sent === false) {
      return res.status(502).json({ ok: false, error: (result as any).error || 'Nao foi possivel enviar o e-mail.' });
    }

    return res.status(200).json({ ok: true, orderId });
  } catch (error: any) {
    const safe = publicError(error, 'Nao foi possivel reenviar o e-mail de download.');
    return res.status(safe.statusCode).json({ error: safe.message });
  }
}
