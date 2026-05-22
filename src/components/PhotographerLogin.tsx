import { useEffect, useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { Camera, Lock, Mail, ArrowRight, Loader2, AlertCircle, Check } from 'lucide-react';
import { Photographer } from '../types';
import { photographerService } from '../lib/services';
import { isMockMode } from '../lib/config';
import { isGoogleAuthEnabled } from '../lib/config';
import { getCurrentUser, loginWithEmail, loginWithGoogle, registerWithEmail } from '../lib/supabase';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';

interface PhotographerLoginProps {
  onLoginSuccess: (photographer: Photographer) => void;
  onBack: () => void;
}

export function PhotographerLogin({ onLoginSuccess, onBack }: PhotographerLoginProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const googleEnabled = !isMockMode && isGoogleAuthEnabled;

  async function requestPendingPhotographer(input: {
    userId?: string | null;
    email: string;
    name: string;
    bio: string;
    cpf: string;
    avatar: string;
  }) {
    const pendingResponse = await fetch('/api/photographers/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!pendingResponse.ok) {
      const payload = await pendingResponse.json().catch(() => ({}));
      throw new Error(payload?.error || 'Erro ao registrar cadastro pendente.');
    }
  }

  useEffect(() => {
    async function finalizeGooglePhotographerRequest() {
      const raw = sessionStorage.getItem('funpace:photographer-google-request');
      const authUser = getCurrentUser();
      if (!raw || !authUser?.email) return;

      setIsLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const payload = JSON.parse(raw) as { name: string; bio: string; cpf: string; avatar: string };
        await requestPendingPhotographer({
          userId: authUser.id,
          email: authUser.email,
          name: payload.name,
          bio: payload.bio,
          cpf: payload.cpf,
          avatar: payload.avatar,
        });
        sessionStorage.removeItem('funpace:photographer-google-request');
        setSuccess('SOLICITACAO ENVIADA: aguarde a aprovacao do administrador para acessar o painel.');
        setIsRegistering(false);
      } catch (error: any) {
        setError(error?.message || 'Erro ao registrar cadastro com Google.');
      } finally {
        setIsLoading(false);
      }
    }

    finalizeGooglePhotographerRequest();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isRegistering) {
        if (!isValidCpf(cpf)) {
          setError('CPF invalido.');
          return;
        }

        if (isMockMode) {
          await photographerService.addPhotographer({
            name,
            email,
            bio,
            cpf: onlyCpfDigits(cpf),
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
            stats: {
              photos: 0,
              events: 0,
              rating: 5.0,
              totalEarnings: 0,
              pendingEarnings: 0,
              salesCount: 0
            }
          });
          setSuccess('CADASTRO MOCK ENVIADO: aprove no painel admin para testar o fluxo.');
          setIsRegistering(false);
          return;
        }

        let authUser = null;
        let requiresEmailConfirmation = false;
        try {
          authUser = await registerWithEmail(email, password, name, onlyCpfDigits(cpf));
        } catch (registerError: any) {
          const registerMessage = String(registerError?.message || registerError || '');
          if (
            registerMessage.toUpperCase().includes('EMAIL_NOT_CONFIRMED') ||
            registerMessage.toUpperCase().includes('E-MAIL NAO CONFIRMADO') ||
            registerMessage.toUpperCase().includes('EMAIL NAO CONFIRMADO') ||
            registerMessage.toUpperCase().includes('NOT CONFIRMED')
          ) {
            requiresEmailConfirmation = true;
          } else {
            throw registerError;
          }
        }

        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;

        // Always register a pending photographer record so admin can approve, even if email confirmation blocks a session.
        await requestPendingPhotographer({
          userId: authUser?.id ?? null,
          email: authUser?.email ?? email,
          name,
          bio,
          cpf: onlyCpfDigits(cpf),
          avatar: avatarUrl,
        });

        // Best-effort: if we have a session already, also create via Supabase REST (keeps auth-aligned flows).
        const currentUser = getCurrentUser();
        if (currentUser?.id) {
          await photographerService.addPhotographer({
            name,
            email: currentUser.email ?? email,
            bio,
            cpf: onlyCpfDigits(cpf),
            avatar: avatarUrl,
            stats: {
              photos: 0,
              events: 0,
              rating: 5.0,
              totalEarnings: 0,
              pendingEarnings: 0,
              salesCount: 0
            }
          });
        }

        if (!authUser?.id || requiresEmailConfirmation) {
          setSuccess('SOLICITACAO ENVIADA: confirme seu e-mail e aguarde a aprovacao do administrador para acessar o painel.');
          setIsRegistering(false);
          return;
        }

        setSuccess('CADASTRO ENVIADO: Aguarde a aprovacao do administrador para acessar o painel.');
        setIsRegistering(false);
      } else {
        if (isMockMode) {
          const photographer = await photographerService.getPhotographerByEmail(email);

          if (photographer?.verified) {
            onLoginSuccess(photographer);
          } else if (photographer) {
            setError('PENDENTE: cadastro mock ainda nao aprovado pelo administrador.');
          } else {
            setError('ACESSO NEGADO: email nao cadastrado como fotografo parceiro.');
          }
          return;
        }

        const authUser = await loginWithEmail(email, password);
        let photographer = authUser
          ? await photographerService.getPhotographerById(authUser.id)
          : null;

        // If the user exists in Auth but the profile row is still pending:<email>, claim it and retry.
        if (!photographer && authUser?.id && authUser?.email) {
          const claimResponse = await fetch('/api/photographers/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: authUser.id, email: authUser.email }),
          });

          if (claimResponse.ok) {
            photographer = await photographerService.getPhotographerById(authUser.id);
          }
        }
        
        if (photographer) {
          if (!photographer.verified) {
            setError('PENDENTE: Seu cadastro ainda nao foi aprovado pelo administrador.');
            return;
          }
          onLoginSuccess(photographer);
        } else {
          setError('ACESSO NEGADO: esta conta ainda nao possui cadastro de fotografo.');
        }
      }
    } catch (err: any) {
      const rawMessage = String(err?.message || 'ERRO DE CONEXAO: Tente novamente mais tarde.');
      if (rawMessage.toUpperCase().includes('EMAIL_NOT_CONFIRMED') || rawMessage.toUpperCase().includes('NOT CONFIRMED')) {
        setError('E-mail ainda nao confirmado. Verifique sua caixa de entrada e SPAM.');
      } else {
        setError(rawMessage);
      }
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      if (isRegistering) {
        if (!name.trim()) throw new Error('Informe seu nome completo.');
        if (!bio.trim()) throw new Error('Informe sua bio/portfolio.');
        if (!isValidCpf(cpf)) throw new Error('CPF invalido.');

        sessionStorage.setItem('funpace:photographer-google-request', JSON.stringify({
          name: name.trim(),
          bio: bio.trim(),
          cpf: onlyCpfDigits(cpf),
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim())}&background=random`,
        }));
      }

      await loginWithGoogle('/fotografo');
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel entrar com Google.');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-brutal-white flex items-center justify-center p-6 sm:py-20 overflow-y-auto">
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-5">
        <div className="absolute top-0 left-0 w-full h-full grid grid-cols-6 gap-4 p-4">
          {Array(24).fill(0).map((_, i) => (
            <Camera key={i} className="w-full h-auto text-brutal-black" />
          ))}
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md bg-white brutal-border brutal-shadow-heavy p-8 md:p-12 my-auto"
      >
        <button 
          onClick={onBack}
          className="absolute -top-12 left-0 font-mono text-xs uppercase tracking-widest text-gray-500 hover:text-brutal-accent transition-colors flex items-center gap-2 cursor-pointer"
        >
          ← Voltar para a Loja
        </button>

        <div className="text-center mb-10">
          <div className="inline-block bg-brutal-accent text-white p-4 brutal-border mb-6">
            <Camera className="w-8 h-8" />
          </div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tighter uppercase mb-2">STUDIO DASH</h1>
          <p className="font-mono text-xs text-gray-500 uppercase tracking-[0.2em]">
            {isRegistering ? 'Cadastro de Fotógrafo' : 'Exclusivo para Fotógrafos'}
          </p>
        </div>

        {success && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border-2 border-green-500 p-4 mb-6 flex items-start gap-3"
          >
            <div className="bg-green-500 text-white p-1 shrink-0 mt-0.5">
              <Check className="w-3 h-3" />
            </div>
            <p className="font-mono text-[10px] text-green-700 font-bold uppercase leading-tight">{success}</p>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {isRegistering && (
            <>
              <div className="space-y-2">
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome Completo</label>
                <input 
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu Nome"
                  className="w-full h-14 px-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Bio / Portfólio</label>
                <textarea 
                  required
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Conte um pouco sobre seu trabalho..."
                  className="w-full h-24 p-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">CPF</label>
                <input 
                  type="text"
                  required
                  value={formatCpf(cpf)}
                  onChange={(e) => setCpf(onlyCpfDigits(e.target.value))}
                  placeholder="000.000.000-00"
                  className="w-full h-14 px-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Email Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@exemplo.com"
                className="w-full h-14 pl-12 pr-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Senha de Acesso</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-14 pl-12 pr-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
              />
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-red-50 border-2 border-red-500 p-4 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="font-mono text-[10px] text-red-600 font-bold uppercase leading-tight">{error}</p>
            </motion.div>
          )}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full h-16 bg-brutal-black text-white brutal-border font-display text-xl uppercase tracking-widest hover:bg-brutal-accent transition-all flex items-center justify-center gap-3 group cursor-pointer disabled:opacity-70 disabled:cursor-wait"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : (
              <>
                {isRegistering ? 'Solicitar Cadastro' : 'Entrar no Painel'}
                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
              </>
            )}
          </button>

          {googleEnabled && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">ou</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <button
                type="button"
                disabled={isLoading}
                onClick={handleGoogleAuth}
                className="w-full h-14 bg-white text-[#3c4043] border border-[#dadce0] hover:bg-[#f8fafd] hover:border-[#d2e3fc] transition-all flex items-center justify-center gap-3 cursor-pointer disabled:opacity-70 disabled:cursor-wait font-sans"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#5f6368]" />
                ) : (
                  <GoogleLogo />
                )}
                <span className="text-sm font-semibold tracking-normal">
                  {isRegistering ? 'Cadastrar com Google' : 'Entrar com Google'}
                </span>
              </button>
            </div>
          )}
        </form>

        <div className="mt-8 text-center">
          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="font-mono text-[10px] uppercase font-bold text-brutal-accent hover:underline tracking-widest"
          >
            {isRegistering ? 'Já tenho cadastro? Fazer Login' : 'Não tem conta? Registre-se aqui'}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest leading-relaxed">
            {isRegistering 
              ? 'Todos os cadastros passam por análise manual da nossa equipe.' 
              : 'Painel de acesso restrito a fotógrafos autorizados.'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
