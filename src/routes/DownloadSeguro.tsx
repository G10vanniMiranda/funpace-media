import React from 'react';
import { ArrowLeft, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getCurrentAccessToken } from '../lib/supabase';

type AuthorizedDownload = {
  downloadUrl: string;
  filename: string;
};

async function generateDownload(orderId: string, orderItemId: string): Promise<AuthorizedDownload> {
  const accessToken = await getCurrentAccessToken();
  const response = await fetch('/api/downloads/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ orderId, orderItemId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.downloadUrl) {
    throw new Error(payload?.error || 'Não foi possível gerar um novo download.');
  }
  return {
    downloadUrl: String(payload.downloadUrl),
    filename: String(payload.filename || 'arquivo Funpace Media'),
  };
}

export function DownloadSeguro() {
  const navigate = useNavigate();
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const orderId = params.get('order') || '';
  const orderItemId = params.get('item') || '';
  const reason = params.get('reason');
  const [authorized, setAuthorized] = React.useState<AuthorizedDownload | null>(null);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    reason === 'expired'
      ? 'Este link expirou por segurança. Clique abaixo para gerar um novo download.'
      : reason === 'unavailable'
        ? 'Não foi possível concluir o download. Gere um novo link e tente novamente.'
        : null,
  );

  const regenerate = React.useCallback(async () => {
    if (!orderId || !orderItemId) {
      setError('Abra este download novamente em Meus Pedidos.');
      return;
    }
    setIsGenerating(true);
    setAuthorized(null);
    try {
      const result = await generateDownload(orderId, orderItemId);
      setAuthorized(result);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível gerar um novo download.');
    } finally {
      setIsGenerating(false);
    }
  }, [orderId, orderItemId]);

  React.useEffect(() => {
    if (!reason && orderId && orderItemId) void regenerate();
  }, [orderId, orderItemId, reason, regenerate]);

  return (
    <main className="min-h-[100svh] bg-[#f5f7fb] px-4 py-8 text-brutal-black sm:px-6">
      <section className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-xl items-center">
        <div className="w-full border-2 border-brutal-black bg-white p-5 shadow-[8px_8px_0_#111] sm:p-8">
          <ShieldCheck className="h-11 w-11 text-brutal-accent" />
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-400">Download seguro</p>
          <h1 className="mt-2 font-display text-4xl uppercase leading-none sm:text-5xl">Sua mídia está protegida</h1>

          {isGenerating && (
            <p className="mt-6 flex items-center gap-2 font-mono text-xs uppercase text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Gerando link temporário...
            </p>
          )}

          {error && <p className="mt-6 border border-amber-300 bg-amber-50 p-4 font-mono text-xs uppercase leading-relaxed text-amber-900">{error}</p>}

          {authorized && (
            <div className="mt-6 border border-green-300 bg-green-50 p-4">
              <p className="font-mono text-xs uppercase leading-relaxed text-green-800">Link pronto: {authorized.filename}</p>
              <p className="mt-2 font-mono text-[10px] uppercase leading-relaxed text-green-700">
                No iPhone ou Android, se o arquivo abrir em vez de baixar, use Compartilhar e depois Salvar.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {authorized ? (
              <a
                href={authorized.downloadUrl}
                className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-brutal-black bg-brutal-black px-5 font-display text-sm uppercase tracking-wider text-white hover:bg-brutal-accent"
              >
                <Download className="h-4 w-4" />
                Baixar novamente
              </a>
            ) : (
              <button
                type="button"
                disabled={isGenerating || !orderId || !orderItemId}
                onClick={regenerate}
                className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-brutal-black bg-brutal-black px-5 font-display text-sm uppercase tracking-wider text-white hover:bg-brutal-accent disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Gerar novo link de download
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(orderId ? `/minha-conta?order=${encodeURIComponent(orderId)}` : '/minha-conta')}
              className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-brutal-black bg-white px-5 font-display text-sm uppercase tracking-wider"
            >
              <ArrowLeft className="h-4 w-4" />
              Meus pedidos
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
