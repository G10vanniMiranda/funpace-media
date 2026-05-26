import { getJsonBody, handleOptions, isUuid, setCors, supabaseRequest, getSupabaseApiConfig } from '../_utils';

function getBearerToken(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseApiConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

function publicMediaUrl(rawPathOrUrl: string) {
  if (/^https?:\/\//i.test(rawPathOrUrl)) return rawPathOrUrl;

  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, '')}/${encodeURI(rawPathOrUrl.replace(/^\/+/, ''))}`;
  }

  return rawPathOrUrl;
}

async function createSignedMediaUrl(rawPathOrUrl: string) {
  return publicMediaUrl(rawPathOrUrl);
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const body = getJsonBody(req);
    const orderId = String(body?.orderId || '');
    const orderItemId = String(body?.orderItemId || '');
    const authUser = await getAuthenticatedRequestUser(req);

    if (!isUuid(orderId) || !isUuid(orderItemId)) {
      return res.status(400).json({ error: 'Download invalido.' });
    }

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente para baixar sua compra.' });
    }

    const orderItems = await supabaseRequest<any[]>(
      `/rest/v1/order_items?select=*&id=eq.${encodeURIComponent(orderItemId)}&limit=1`,
    );
    const item = orderItems[0];

    if (!item || item.orderId !== orderId) {
      return res.status(404).json({ error: 'Item do pedido nao encontrado.' });
    }

    const orders = await supabaseRequest<any[]>(
      `/rest/v1/orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    const order = orders[0];

    if (!order || order.status !== 'paid') {
      return res.status(403).json({ error: 'Download liberado apenas para pedidos pagos.' });
    }

    if (order.userId !== authUser.id) {
      return res.status(403).json({ error: 'Este pedido nao pertence ao usuario logado.' });
    }

    const products = await supabaseRequest<any[]>(
      `/rest/v1/products?select=*&id=eq.${encodeURIComponent(item.productId)}&limit=1`,
    );
    const product = products[0];

    await supabaseRequest('/rest/v1/download_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        orderId: item.orderId,
        orderItemId: item.id,
        productId: item.productId,
        vendedorId: item.vendedorId,
        buyerEmail: order.buyerEmail,
        userId: order.userId,
        ipHash: null,
        userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
      }),
    }).catch((error) => {
      console.error('Nao foi possivel registrar evento de download:', error);
    });

    const url = await createSignedMediaUrl(product?.storagePath || item.url);
    return res.status(200).json({ url });
  } catch (error: any) {
    console.error('Erro ao autorizar download:', error);
    return res.status(500).json({ error: error?.message || 'Nao foi possivel autorizar o download.' });
  }
}
