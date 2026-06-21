import { getJsonBody, getSupabaseApiConfig, handleOptions, setCors, supabaseRequest } from '../../server/shared/utils.js';

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

function devLog(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`[photographer-signup] ${message}`, metadata || {});
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  let step = 'inicio';

  try {
    step = 'parse_body';
    const { userId, email } = getJsonBody(req);
    const authUser = await getAuthenticatedRequestUser(req);

    step = 'validacao';
    if (typeof userId !== 'string' || userId.trim().length < 8) {
      return res.status(400).json({ error: 'userId invalido.' });
    }

    if (typeof email !== 'string' || !email.includes('@') || email.length > 256) {
      return res.status(400).json({ error: 'Email invalido.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    devLog('Email confirmado/login autenticado; claim iniciado', { userId: userId.trim(), email: normalizedEmail });
    if (!authUser?.id || authUser.id !== userId.trim() || (authUser.email && authUser.email !== normalizedEmail)) {
      return res.status(403).json({ error: 'Usuário autenticado não corresponde ao cadastro reivindicado.' });
    }

    step = 'buscar_por_id_auth';
    const authRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=id,verified&id=eq.${encodeURIComponent(userId.trim())}&limit=1`,
    );

    if (authRows.length > 0) {
      await supabaseRequest(
        `/rest/v1/photographers?id=eq.${encodeURIComponent(userId.trim())}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            auth_user_id: userId.trim(),
            email: normalizedEmail,
            status: authRows[0]?.verified ? 'active' : 'pending',
            approved: Boolean(authRows[0]?.verified),
            isPublic: Boolean(authRows[0]?.verified),
          }),
        },
      ).catch((error) => devLog('Nao foi possivel atualizar metadados do claim ja vinculado', { error: String(error?.message || error) }));
      devLog('Cadastro ja vinculado ao auth.users', { userId: userId.trim(), verified: Boolean(authRows[0]?.verified) });
      return res.status(200).json({ ok: true, moved: 0, alreadyLinked: true });
    }

    step = 'buscar_por_email';
    const photographerRows = await supabaseRequest<any[]>(
      `/rest/v1/photographers?select=*&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
    );

    if (photographerRows.length === 0) {
      devLog('Cadastro pendente nao encontrado por email', { userId: userId.trim(), email: normalizedEmail });
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
          auth_user_id: userId.trim(),
          email: normalizedEmail,
          status: photographer.verified ? 'active' : 'pending',
          approved: Boolean(photographer.verified),
          isPublic: Boolean(photographer.verified),
        }),
      },
    );

    if (!updated || updated.id !== userId.trim()) {
      return res.status(409).json({
        error: 'Cadastro aprovado, mas não foi possível sincronizar o ID do fotógrafo.',
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
        error: 'Sincronização executada, mas o cadastro ainda não foi encontrado pelo ID do usuário.',
        source: 'photographers-claim',
        step,
      });
    }

    devLog('Photographer sincronizado com auth.users', { previousId: photographer.id, userId: userId.trim(), verified: Boolean(confirmed.verified) });

    return res.status(200).json({
      ok: true,
      moved: 1,
      id: confirmed.id,
      verified: Boolean(confirmed.verified),
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Erro ao reivindicar cadastro de fotógrafo pendente.',
      source: 'photographers-claim',
      step,
    });
  }
}
