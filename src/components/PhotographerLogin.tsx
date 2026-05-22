import { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { Camera, Lock, Mail, ArrowRight, Loader2, AlertCircle, Check } from 'lucide-react';
import { Photographer } from '../types';
import { photographerService } from '../lib/services';
import { isMockMode } from '../lib/config';
import { loginWithEmail, registerWithEmail } from '../lib/supabase';
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
      const detail = payload?.error || payload?.message || 'Erro ao registrar cadastro pendente.';
      throw new Error(`Nao foi possivel registrar cadastro pendente: ${detail}`);
    }
  }

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

        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;

        await requestPendingPhotographer({
          userId: null,
          email,
          name,
          bio,
          cpf: onlyCpfDigits(cpf),
          avatar: avatarUrl,
        });

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

        if (authUser?.id) {
          await requestPendingPhotographer({
            userId: authUser.id,
            email: authUser.email ?? email,
            name,
            bio,
            cpf: onlyCpfDigits(cpf),
            avatar: avatarUrl,
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
        const loginEmail = (authUser?.email ?? email).trim().toLowerCase();
        let photographer = authUser
          ? await photographerService.getPhotographerById(authUser.id)
          : null;

        if (authUser?.id && loginEmail) {
          try {
            const claimResponse = await fetch('/api/photographers/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: authUser.id, email: loginEmail }),
            });

            if (claimResponse.ok) {
              photographer = await photographerService.getPhotographerById(authUser.id);
            }
          } catch (claimError) {
            console.warn('Nao foi possivel sincronizar cadastro do fotografo.', claimError);
          }
        }

        if (!photographer && loginEmail) {
          photographer = await photographerService.getPhotographerByEmail(loginEmail);
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
