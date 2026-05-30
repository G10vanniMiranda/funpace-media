import { getJsonBody, handleOptions, setCors, supabaseRequest } from '../../server/shared/utils.ts';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  let step = 'inicio';

  try {
    step = 'parse_body';
    const { userId, email } = getJsonBody(req);

    step = 'validacao';
    if (typeof userId !== 'string' || userId.trim().length < 8) {
      return res.status(400).json({ error: 'userId invalido.' });
    }

    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    step = 'buscar_por_id_auth';
    const authRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=id,verified&id=eq.${encodeURIComponent(userId.trim())}&limit=1`,
    );

    if (authRows.length > 0) {
      return res.status(200).json({ ok: true, moved: 0, alreadyLinked: true });
    }

    step = 'buscar_por_email';
    const photographerRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=*&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
    );

    if (photographerRows.length === 0) {
      return res.status(200).json({ ok: true, moved: 0 });
    }

    const photographer = photographerRows[0];
    if (photographer.id === userId.trim()) {
      return res.status(200).json({ ok: true, moved: 0, alreadyLinked: true });
    }

    step = 'atualizar_id_por_email';
    const [updated] = await supabaseRequest<any[]>(
      `/rest/v1/photographers?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,email,verified`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          id: userId.trim(),
          email: normalizedEmail,
        }),
      },
    );

    if (!updated || updated.id !== userId.trim()) {
      return res.status(409).json({
        error: 'Cadastro aprovado, mas nao foi possivel sincronizar o id do fotografo.',
        source: 'photographers-claim',
        step,
      });
    }

    step = 'confirmar_atualizacao';
    const confirmedRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=id,email,verified&id=eq.${encodeURIComponent(userId.trim())}&limit=1`,
    );
    const confirmed = confirmedRows[0];

    if (!confirmed) {
      return res.status(409).json({
        error: 'Sincronizacao executada, mas o cadastro ainda nao foi encontrado pelo id do usuario.',
        source: 'photographers-claim',
        step,
      });
    }

    return res.status(200).json({
      ok: true,
      moved: 1,
      id: confirmed.id,
      verified: Boolean(confirmed.verified),
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Erro ao claim de fotografo pendente.',
      source: 'photographers-claim',
      step,
    });
  }
}
