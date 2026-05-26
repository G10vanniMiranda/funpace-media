import { getJsonBody, handleOptions, isUuid, setCors, supabaseRequest } from '../shared/utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  try {
    const body = getJsonBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const productIds = [...new Set(items.map((item: any) => item.id))];

    if (!productIds.every(isUuid)) {
      return res.status(400).json({ ok: false, error: 'IDs invalidos.', productIds });
    }

    const products = productIds.length
      ? await supabaseRequest<any[]>(`/rest/v1/products?select=id,name,price,status&id=in.(${productIds.join(',')})`)
      : [];

    return res.status(200).json({
      ok: true,
      itemCount: items.length,
      productIds,
      productCount: products.length,
      products,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro no debug do checkout.',
      stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack,
    });
  }
}
