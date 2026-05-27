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

function onlyCpfDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '').slice(0, 11);
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

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
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

function getCheckoutEndpoint() {
  return process.env.INFINITEPAY_CHECKOUT_ENDPOINT || 'https://api.checkout.infinitepay.io/links';
}

function getAllowedRedirectOrigins(req: any) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return new Set([
    `https://${host}`,
    `${proto}://${host}`,
    'https://funpace.media',
    'https://www.funpace.media',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => String(origin).replace(/\/+$/, '')));
}

function buildSafeSuccessUrl(req: any, inputUrl: string | undefined, orderId: string) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const fallback = `${proto}://${host}/pagamento/sucesso`;
  const candidate = new URL(inputUrl || fallback, fallback);
  const origin = candidate.origin.replace(/\/+$/, '');

  if (!getAllowedRedirectOrigins(req).has(origin)) {
    throw new Error('URL de retorno do checkout nao autorizada.');
  }

  candidate.searchParams.set('payment', 'success');
  candidate.searchParams.set('order', orderId);
  return candidate.toString();
}

function assertInfinitePayCheckoutUrl(value: string) {
  const parsed = new URL(value);
  const allowedHosts = (process.env.INFINITEPAY_CHECKOUT_ALLOWED_HOSTS || 'infinitepay.io,checkout.infinitepay.io,api.checkout.infinitepay.io')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const hostname = parsed.hostname.toLowerCase();
  const allowed = parsed.protocol === 'https:' && allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

  if (!allowed) {
    throw new Error('InfinitePay retornou uma URL de checkout fora dos dominios permitidos.');
  }
}

function getBearerToken(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
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

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const { items, successUrl, buyer } = getJsonBody(req);
    const authUser = await getAuthenticatedRequestUser(req);

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente para iniciar o pagamento.' });
    }

    if (!buyer?.cpf || !isValidCpf(buyer.cpf)) {
      return res.status(400).json({ error: 'CPF valido e obrigatorio para pagamento.' });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: 'Dados do comprador incompletos.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio.' });
    }

    const productIds = [...new Set(items.map((item: any) => String(item.id || '').trim()))].filter(Boolean);
    if (productIds.length !== items.length || productIds.some((id) => id.length > 120 || /[(),]/.test(id))) {
      return res.status(400).json({ error: 'Carrinho contem produto invalido.' });
    }

    const products = await supabaseRequest<any[]>(
      `/rest/v1/products?select=id,name,price,url,type,vendedorId,bib,event,checkpoint,thumbnailUrl&id=in.(${productIds.join(',')})&status=eq.published`,
    );

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'Um ou mais produtos nao estao disponiveis.' });
    }

    const total = products.reduce((sum: number, product: any) => sum + Number(product.price), 0);
    if (total <= 1) {
      return res.status(400).json({ error: 'A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.' });
    }

    const buyerName = String(buyer.fullName).trim();
    const inputBuyerEmail = String(buyer.email).trim().toLowerCase();
    if (authUser.email && inputBuyerEmail && inputBuyerEmail !== authUser.email) {
      return res.status(403).json({ error: 'Use o mesmo e-mail da conta logada para finalizar a compra.' });
    }

    const buyerEmail = authUser.email || inputBuyerEmail;
    const buyerPhone = String(buyer.phone || 'nao_informado').trim();
    const buyerCpf = onlyCpfDigits(buyer.cpf);

    await supabaseRequest('/rest/v1/customers?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: authUser.id,
        email: buyerEmail,
        name: buyerName,
        phone: buyerPhone,
        cpf: buyerCpf,
      }),
    });

    const [order] = await supabaseRequest<any[]>('/rest/v1/orders?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        userId: authUser.id,
        buyerName,
        buyerEmail,
        buyerPhone,
        buyerCpf,
        total,
        status: 'pending',
        paymentProvider: 'infinitepay',
      }),
    });

    const orderId = order?.id;
    if (!orderId) {
      return res.status(500).json({ error: 'Supabase nao retornou o ID do pedido.' });
    }

    await supabaseRequest('/rest/v1/order_items', {
      method: 'POST',
      body: JSON.stringify(products.map((product: any) => ({
        orderId,
        productId: product.id,
        name: product.name,
        type: product.type,
        price: product.price,
        url: product.url,
        vendedorId: product.vendedorId,
        bib: product.bib,
        event: product.event,
        checkpoint: product.checkpoint,
        thumbnailUrl: product.thumbnailUrl,
      }))),
    });

    const handle = process.env.INFINITEPAY_HANDLE;
    if (!handle) {
      return res.status(500).json({ error: 'INFINITEPAY_HANDLE nao configurado.' });
    }

    const successRedirectUrl = buildSafeSuccessUrl(req, successUrl, orderId);

    const phoneDigits = typeof buyer.phone === 'string' ? String(buyer.phone).replace(/\D/g, '') : '';
    const checkoutPayload: any = {
      handle,
      order_nsu: orderId,
      redirect_url: successRedirectUrl,
      webhook_url: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/webhooks/infinitepay`,
      items: products.map((product: any) => ({
        quantity: 1,
        price: Math.round(Number(product.price) * 100),
        description: `Download digital - ${String(product.name || 'Foto').slice(0, 100)}`,
      })),
    };

    if (phoneDigits.length >= 10) {
      checkoutPayload.customer = {
        name: String(buyer.fullName || '').slice(0, 120),
        email: String(buyer.email || '').slice(0, 256),
        phone_number: `+55${phoneDigits}`,
      };
    }

    const checkoutResponse = await fetch(getCheckoutEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload),
    });
    const checkoutRaw = await checkoutResponse.text();
    let checkoutData: any = {};

    try {
      checkoutData = checkoutRaw ? JSON.parse(checkoutRaw) : {};
    } catch {
      checkoutData = { message: checkoutRaw };
    }

    if (!checkoutResponse.ok) {
      await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed' }),
      }).catch(() => undefined);

      return res.status(502).json({
        error: checkoutData?.message || checkoutData?.error || checkoutRaw || 'Falha ao gerar link na InfinitePay.',
      });
    }

    const checkoutUrl = checkoutData?.url || checkoutData?.link || checkoutData?.checkout_url || checkoutData?.payment_url || '';
    if (!checkoutUrl) {
      await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed' }),
      }).catch(() => undefined);

      return res.status(502).json({ error: 'Resposta invalida da InfinitePay ao criar link.' });
    }

    try {
      assertInfinitePayCheckoutUrl(checkoutUrl);
    } catch (error: any) {
      await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed' }),
      }).catch(() => undefined);

      return res.status(502).json({ error: error?.message || 'URL de checkout invalida.' });
    }

    await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ checkoutUrl }),
    });

    return res.status(200).json({ url: checkoutUrl, orderId, total });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Erro interno ao criar checkout.',
      source: 'checkout-create-session',
    });
  }
}
