import { getInfinitePayCheckoutEndpoint, handleOptions, isUuid, isValidCpf, onlyCpfDigits, setCors, supabaseRequest } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const { items, successUrl, userId, buyer } = req.body || {};

    if (!buyer?.cpf || !isValidCpf(buyer.cpf)) {
      return res.status(400).json({ error: 'CPF valido e obrigatorio para pagamento.' });
    }

    if (!buyer?.fullName || !buyer?.email) {
      return res.status(400).json({ error: 'Dados do comprador incompletos.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio.' });
    }

    const productIds = [...new Set(items.map((item: any) => item.id))];
    if (!productIds.every(isUuid)) {
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

    const [order] = await supabaseRequest<any[]>(
      '/rest/v1/orders?select=id',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          userId: userId && userId !== 'guest' ? userId : null,
          buyerName: String(buyer.fullName).trim(),
          buyerEmail: String(buyer.email).trim().toLowerCase(),
          buyerPhone: String(buyer.phone || 'nao_informado').trim(),
          buyerCpf: onlyCpfDigits(buyer.cpf),
          total,
          status: 'pending',
          paymentProvider: 'infinitepay',
        }),
      },
    );

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

    const fallbackSuccessUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/pagamento/sucesso`;
    const successRedirect = new URL(successUrl || fallbackSuccessUrl);
    successRedirect.searchParams.set('payment', 'success');
    successRedirect.searchParams.set('order', orderId);

    const phoneDigits = typeof buyer.phone === 'string' ? String(buyer.phone).replace(/\D/g, '') : '';
    const phoneE164 = phoneDigits.length >= 10 ? `+55${phoneDigits}` : '';

    const checkoutPayload: any = {
      handle,
      order_nsu: orderId,
      redirect_url: successRedirect.toString(),
      webhook_url: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/webhooks/infinitepay`,
      items: products.map((product: any) => ({
        quantity: 1,
        price: Math.round(Number(product.price) * 100),
        description: `Download digital - ${String(product.name || 'Foto').slice(0, 100)}`,
      })),
    };

    if (phoneE164) {
      checkoutPayload.customer = {
        name: String(buyer.fullName || '').slice(0, 120),
        email: String(buyer.email || '').slice(0, 256),
        phone_number: phoneE164,
      };
    }

    const checkoutResponse = await fetch(getInfinitePayCheckoutEndpoint(), {
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
      return res.status(502).json({ error: checkoutData?.message || checkoutData?.error || checkoutRaw || 'Falha ao gerar link na InfinitePay.' });
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

    await supabaseRequest(`/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ checkoutUrl }),
    });

    return res.status(200).json({ url: checkoutUrl, orderId, total });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro interno ao criar checkout.' });
  }
}
