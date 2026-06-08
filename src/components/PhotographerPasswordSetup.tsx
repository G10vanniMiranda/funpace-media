import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Camera, Check, Loader2, Lock, Mail } from 'lucide-react';
import { completePasswordSetupFromUrl, updateCurrentUserPassword, type AppUser } from '../lib/supabase';

export function PhotographerPasswordSetup() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadInviteSession() {
      try {
        const sessionUser = await completePasswordSetupFromUrl();
        setUser(sessionUser);
        if (!sessionUser?.email) {
          setError('Link inválido ou expirado. Solicite um novo convite ao administrador.');
        }
      } catch (err: any) {
        setError(err?.message || 'Não foi possível validar o convite.');
      } finally {
        setIsLoading(false);
      }
    }

    loadInviteSession();
  }, []);

  async function claimPhotographerProfile(nextUser: AppUser) {
    if (!nextUser.id || !nextUser.email) return;

    await fetch('/api/photographers/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: nextUser.id, email: nextUser.email }),
    }).catch(() => null);
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }

    setIsSaving(true);
    try {
      const updatedUser = await updateCurrentUserPassword(password);
      if (updatedUser) {
        await claimPhotographerProfile(updatedUser);
        setUser(updatedUser);
      }

      setSuccess('Senha criada com sucesso. Redirecionando para o painel do fotógrafo...');
      window.setTimeout(() => {
        window.location.assign('/fotografo');
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a senha.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080d14] text-white flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.04]">
        <div className="grid grid-cols-8 gap-4 p-4">
          {Array(64).fill(0).map((_, index) => (
            <Camera key={index} className="w-full h-auto text-white" />
          ))}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg bg-[#0d131c] border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
      >
        <div className="h-1.5 bg-brutal-accent" />
        <div className="p-7 md:p-9 border-b border-white/10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brutal-accent/10 border border-brutal-accent/30 text-brutal-accent font-mono text-[10px] uppercase tracking-widest mb-5">
            <Lock className="w-3.5 h-3.5" />
            Acesso do fotógrafo
          </div>
          <h1 className="font-sans font-black text-3xl md:text-4xl uppercase tracking-normal mb-2">Criar Senha</h1>
          <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">Defina sua senha para acessar o painel</p>
        </div>

        <form onSubmit={handleSubmit} className="p-7 md:p-9 space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-3 border border-white/10 bg-[#080d14] p-4">
              <Loader2 className="w-5 h-5 text-brutal-accent animate-spin" />
              <p className="font-mono text-[10px] uppercase text-gray-400">Validando convite...</p>
            </div>
          ) : (
            <>
              {user?.email && (
                <div className="flex items-center gap-3 border border-white/10 bg-[#080d14] p-4">
                  <Mail className="w-5 h-5 text-brutal-accent" />
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase text-gray-500">E-mail autorizado</p>
                    <p className="font-mono text-xs text-white truncate">{user.email}</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nova Senha</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimo de 8 caracteres"
                  className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Confirmar Senha</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full h-14 px-4 bg-[#080d14] border border-white/15 text-white placeholder:text-gray-600 font-mono text-sm outline-none focus:border-brutal-accent transition-colors"
                />
              </div>
            </>
          )}

          {error && (
            <div className="border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="font-mono text-[10px] text-red-200 uppercase leading-relaxed">{error}</p>
            </div>
          )}

          {success && (
            <div className="border border-green-500/40 bg-green-500/10 p-4 flex items-start gap-3">
              <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
              <p className="font-mono text-[10px] text-green-200 uppercase leading-relaxed">{success}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isSaving || !user?.email}
            className="w-full h-14 bg-brutal-accent text-white border border-brutal-accent font-sans font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brutal-accent transition-colors flex items-center justify-center gap-3 disabled:bg-gray-700 disabled:border-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                Salvar Senha
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
