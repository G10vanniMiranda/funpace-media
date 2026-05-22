import { getJsonBody, handleOptions, setCors, supabaseRequest } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const { userId, email } = getJsonBody(req);

    if (typeof userId !== 'string' || userId.trim().length < 8) {
      return res.status(400).json({ error: 'userId invalido.' });
    }

    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pendingId = `pending:${normalizedEmail}`;

    const pendingRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=*&id=eq.${encodeURIComponent(pendingId)}&limit=1`,
    );

    if (pendingRows.length === 0) {
      return res.status(200).json({ ok: true, moved: 0 });
    }

    const pending = pendingRows[0];
    await supabaseRequest('/rest/v1/photographers?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        ...pending,
        id: userId.trim(),
        email: normalizedEmail,
      }),
    });

    await supabaseRequest(`/rest/v1/photographers?id=eq.${encodeURIComponent(pendingId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });

    return res.status(200).json({ ok: true, moved: 1 });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro ao claim de fotografo pendente.' });
  }
}
