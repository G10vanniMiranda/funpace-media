import { getJsonBody, handleOptions, isValidCpf, onlyCpfDigits, setCors, supabaseRequest } from '../_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const { userId, email, name, bio, cpf, avatar } = getJsonBody(req);

    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Nome invalido.' });
    }

    const cpfDigits = onlyCpfDigits(typeof cpf === 'string' ? cpf : '');
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return res.status(400).json({ error: 'CPF valido e obrigatorio para cadastro de fotografo.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const resolvedId = typeof userId === 'string' && userId.trim().length >= 8
      ? userId.trim()
      : `pending:${normalizedEmail}`;

    const safeBio = typeof bio === 'string' ? bio.slice(0, 1000) : '';
    const safeAvatar = typeof avatar === 'string' ? avatar.slice(0, 2048) : '';

    await supabaseRequest('/rest/v1/photographers?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: resolvedId,
        name: name.trim(),
        email: normalizedEmail,
        bio: safeBio,
        avatar: safeAvatar,
        cpf: cpfDigits,
        verified: false,
        stats: {
          photos: 0,
          events: 0,
          rating: 5,
          totalEarnings: 0,
          pendingEarnings: 0,
          salesCount: 0,
        },
      }),
    });

    return res.status(200).json({ ok: true, id: resolvedId });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Erro ao registrar fotografo pendente.' });
  }
}
