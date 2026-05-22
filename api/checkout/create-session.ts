import { createPool, getInfinitePayCheckoutEndpoint, handleOptions, isUuid, isValidCpf, onlyCpfDigits, setCors } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  let pool: Awaited<ReturnType<typeof createPool>> | null = null;

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

    pool = await createPool();
    await pool.query('begin');

    const productsResult = await pool.query(
      `
        select id, name, price, url, type, "vendedorId", bib, event, checkpoint, "thumbnailUrl"
        from public.products
        where id = any($1::uuid[])
          and status = 'published'
      `,
      [productIds],
    );

    if (productsResult.rowCount !== productIds.length) {
      await pool.query('rollback');
      return res.status(400).json({ error: 'Um ou mais produtos nao estao disponiveis.' });
    }

    const products = productsResult.rows;
    const total = products.reduce((sum: number, product: any) => sum + Number(product.price), 0);

    if (total <= 1) {
      await pool.query('rollback');
      return res.status(400).json({ error: 'A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.' });
    }

    const orderResult = await pool.query(
      `
        insert into public.orders (
          "userId", "buyerName", "buyerEmail", "buyerPhone", "buyerCpf", total, status, "paymentProvider"
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', 'infinitepay')
        returning id
      `,
      [
        userId && userId !== 'guest' ? userId : null,
        String(buyer.fullName).trim(),
        String(buyer.email).trim().toLowerCase(),
        String(buyer.phone || 'nao_informado').trim(),
        onlyCpfDigits(buyer.cpf),
        total,
      ],
    );

    const orderId = orderResult.rows[0].id;

    for (const product of products) {
      await pool.query(
        `
          insert into public.order_items (
            "orderId", "productId", name, type, price, url, "vendedorId", bib, event, checkpoint, "thumbnailUrl"
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          orderId,
          product.id,
          product.name,
          product.type,
          product.price,
          product.url,
          product.vendedorId,
          product.bib,
          product.event,
          product.checkpoint,
          product.thumbnailUrl,
        ],
      );
    }

    const handle = process.env.INFINITEPAY_HANDLE;
    if (!handle) {
      await pool.query('rollback');
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
    const checkoutData = checkoutRaw ? JSON.parse(checkoutRaw) : {};

    if (!checkoutResponse.ok) {
      await pool.query('rollback');
      return res.status(502).json({ error: checkoutData?.message || checkoutData?.error || checkoutRaw || 'Falha ao gerar link na InfinitePay.' });
    }

    const checkoutUrl = checkoutData?.url || checkoutData?.link || checkoutData?.checkout_url || checkoutData?.payment_url || '';
    if (!checkoutUrl) {
      await pool.query('rollback');
      return res.status(502).json({ error: 'Resposta invalida da InfinitePay ao criar link.' });
    }

    await pool.query('update public.orders set "checkoutUrl" = $1 where id = $2', [checkoutUrl, orderId]);
    await pool.query('commit');

    return res.status(200).json({ url: checkoutUrl, orderId, total });
  } catch (error: any) {
    if (pool) {
      await pool.query('rollback').catch(() => undefined);
    }
    return res.status(500).json({ error: error?.message || 'Erro interno ao criar checkout.' });
  } finally {
    if (pool) await pool.end().catch(() => undefined);
  }
}
