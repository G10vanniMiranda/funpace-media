import { fulfillPaidOrder, recordPayment } from '../../../shared/checkoutFulfillment.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'PATCH,OPTIONS');
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

function getJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const adminUser = await getAuthenticatedAdminUser(req);
    if (!adminUser) return res.status(403).json({ error: 'Acesso admin não autorizado.' });

    const body = getJsonBody(req);
    const orderId = String(body.orderId || '').trim();
    const status = String(body.status || '').trim();
    if (!orderId || !status) return res.status(400).json({ error: 'Pedido e status sao obrigatorios.' });
    if (!['pending', 'paid', 'failed', 'cancelled', 'canceled', 'refused', 'refunded'].includes(status)) {
      return res.status(400).json({ error: 'Status de pedido invalido.' });
    }

    const [existing] = await supabaseRequest<any[]>(
      `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`,
    );
    if (!existing) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const manualPaymentId = `manual:${orderId}`;
    const orderPatch: Record<string, any> = { status, updatedAt: new Date().toISOString() };
    if (status === 'paid') {
      orderPatch.paymentExternalId = manualPaymentId;
    } else if (existing.paymentExternalId?.startsWith?.('manual:')) {
      orderPatch.paymentExternalId = null;
    }

    const [updated] = await supabaseRequest<any[]>(
      `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(orderPatch),
      },
    );

    if (!updated) return res.status(404).json({ error: 'Pedido não encontrado.' });

    if (status === 'paid') {
      await recordPayment({
        orderId,
        provider: updated.paymentProvider || 'manual',
        providerPaymentId: updated.paymentExternalId || manualPaymentId,
        method: updated.paymentMethod || 'pix',
        status: 'paid',
        rawResponse: {
          source: 'admin_status_update',
          actorId: adminUser.id,
          actorEmail: adminUser.email,
        },
      });
      await supabaseRequest(`/rest/v1/payments?orderId=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'paid',
          updatedAt: new Date().toISOString(),
        }),
      });
      await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          provider: updated.paymentProvider || 'manual',
          eventId: `${orderId}:admin-status-paid`,
          orderId,
          status: 'paid',
          payload: {
            source: 'admin_status_update',
            actorId: adminUser.id,
            actorEmail: adminUser.email,
          },
        }),
      });
      await fulfillPaidOrder(orderId);
    } else {
      await supabaseRequest(`/rest/v1/payments?orderId=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status,
          updatedAt: new Date().toISOString(),
        }),
      }).catch((error) => console.error('Não foi possível sincronizar pagamentos do pedido:', error));

      if (existing.status === 'paid') {
        const items = await supabaseRequest<any[]>(
          `/rest/v1/order_items?select=id,productId&orderId=eq.${encodeURIComponent(orderId)}`,
        ).catch(() => []);

        await supabaseRequest(`/rest/v1/download_access?orderId=eq.${encodeURIComponent(orderId)}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        }).catch((error) => console.error('Não foi possível remover download_access do pedido:', error));

        await supabaseRequest(`/rest/v1/photographer_transactions?orderId=eq.${encodeURIComponent(orderId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'cancelled' }),
        }).catch((error) => console.error('Não foi possível cancelar transações do fotógrafo:', error));

        for (const item of items) {
          const rows = await supabaseRequest<any[]>(
            `/rest/v1/products?select=salesCount&id=eq.${encodeURIComponent(item.productId)}&limit=1`,
          ).catch(() => []);
          const nextSalesCount = Math.max(0, Number(rows[0]?.salesCount || 0) - 1);
          await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(item.productId)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ salesCount: nextSalesCount }),
          }).catch(() => undefined);
        }
      }

      await supabaseRequest('/rest/v1/payment_events?on_conflict=provider,eventId', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          provider: updated.paymentProvider || 'manual',
          eventId: `${orderId}:admin-status-${status}`,
          orderId,
          status,
          payload: {
            source: 'admin_status_update',
            previousStatus: existing.status,
            actorId: adminUser.id,
            actorEmail: adminUser.email,
          },
        }),
      }).catch((error) => console.error('Não foi possível registrar evento de status admin:', error));
    }

    return res.status(200).json({ order: updated });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro ao atualizar pedido.' });
  }
}
