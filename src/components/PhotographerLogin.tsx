import { useState, FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Camera, Lock, Mail, ArrowRight, Loader2, AlertCircle, Check } from 'lucide-react';
import { Photographer } from '../types';
import { photographerService, referralService } from '../lib/services';
import { isMockMode } from '../lib/config';
import { getCurrentAccessToken, loginWithEmail, registerWithEmail } from '../lib/supabase';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';
import { formatWhatsapp, onlyWhatsappDigits } from '../lib/phone';

interface PhotographerLoginProps {
  onLoginSuccess: (photographer: Photographer) => void;
  onBack: () => void;
}

export function PhotographerLogin({ onLoginSuccess, onBack }: PhotographerLoginProps) {
  const location = useLocation();
  const [isRegistering, setIsRegistering] = useState(() => new URLSearchParams(location.search).get('cadastro') === '1');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [instagram, setInstagram] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingPasswordLink, setIsSendingPasswordLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const normalizeInstagramHandle = (value: string) => String(value || '').trim().replace(/^@+/, '').toLowerCase();
  const isValidInstagramHandle = (value: string) => /^[a-z0-9._]{1,30}$/.test(normalizeInstagramHandle(value));

  async function requestPendingPhotographer(input: {
    userId?: string | null;
    email: string;
    name: string;
    instagram: string;
    bio: string;
    phone: string;
    cpf: string;
    avatar: string;
  }) {
    const referralCode = referralService.getStoredReferralCode();
    if (import.meta.env.DEV) {
      console.info('[photographer-signup] Cadastro iniciado', {
        email: input.email,
        hasUserId: Boolean(input.userId),
        hasReferralCode: Boolean(referralCode),
      });
    }
    const pendingResponse = await fetch('/api/photographers/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, referralCode: referralCode || null }),
    });

    if (!pendingResponse.ok) {
      const payload = await pendingResponse.json().catch(() => ({}));
      const detail = payload?.error || payload?.message || 'Erro ao registrar cadastro pendente.';
      throw new Error(`Não foi possível registrar o cadastro pendente: ${detail}`);
    }
  }

  const handleSendPasswordSetupLink = async () => {
    setError(null);
    setSuccess(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Informe seu e-mail cadastrado para receber o link de senha.');
      return;
    }

    setIsSendingPasswordLink(true);
    try {
      const response = await fetch('/api/photographers/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Não foi possível enviar o link.');
      }

      setSuccess(payload?.message || 'Se este e-mail estiver cadastrado, enviaremos um link para criar a senha.');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível enviar o link de senha.');
    } finally {
      setIsSendingPasswordLink(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isRegistering) {
        const phoneDigits = onlyWhatsappDigits(phone);
        if (phoneDigits.length < 10) {
          setError('Telefone inválido.');
          return;
        }

        if (!isValidCpf(cpf)) {
          setError('CPF inválido.');
          return;
        }

        const instagramHandle = normalizeInstagramHandle(instagram);
        if (!isValidInstagramHandle(instagramHandle)) {
          setError('Instagram inválido. Use apenas letras, números, pontos e underline.');
          return;
        }

        const formattedInstagram = `@${instagramHandle}`;

        if (isMockMode) {
          await photographerService.addPhotographer({
            name,
            email,
            instagram: formattedInstagram,
            bio,
            phone: phoneDigits,
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
          referralService.clearStoredReferralCode();
          setIsRegistering(false);
          return;
        }

        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;

        await requestPendingPhotographer({
          userId: null,
          email,
          name,
          instagram: formattedInstagram,
          bio,
          phone: phoneDigits,
          cpf: onlyCpfDigits(cpf),
          avatar: avatarUrl,
        });

        let authUser = null;
        let requiresEmailConfirmation = false;
        try {
          authUser = await registerWithEmail(email, password, name, onlyCpfDigits(cpf), phoneDigits, formattedInstagram);
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
            instagram: formattedInstagram,
            bio,
            phone: phoneDigits,
            cpf: onlyCpfDigits(cpf),
            avatar: avatarUrl,
          });
        }

        if (!authUser?.id || requiresEmailConfirmation) {
          setSuccess('SOLICITAÇÃO ENVIADA: confirme seu e-mail e aguarde a aprovação do administrador para acessar o painel.');
          referralService.clearStoredReferralCode();
          setIsRegistering(false);
          return;
        }

        setSuccess('CADASTRO ENVIADO: aguarde a aprovação do administrador para acessar o painel.');
        referralService.clearStoredReferralCode();
        setIsRegistering(false);
      } else {
        if (isMockMode) {
          const photographer = await photographerService.getPhotographerByEmail(email);

          if (photographer?.verified) {
            onLoginSuccess(photographer);
          } else if (photographer) {
            setError('PENDENTE: cadastro de teste ainda não aprovado pelo administrador.');
          } else {
            setError('ACESSO NEGADO: e-mail não cadastrado como fotógrafo parceiro.');
          }
          return;
        }

        const authUser = await loginWithEmail(email, password);
        const loginEmail = (authUser?.email ?? email).trim().toLowerCase();
        let photographer = authUser
          ? await photographerService.getPhotographerById(authUser.id)
          : null;

        if (authUser?.id && loginEmail) {
          let claimDetail = '';
          try {
            const token = await getCurrentAccessToken();
            const claimResponse = await fetch('/api/photographers/claim', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ userId: authUser.id, email: loginEmail }),
            });

            if (claimResponse.ok) {
              if (import.meta.env.DEV) {
                const claimPayload = await claimResponse.clone().json().catch(() => null);
                console.info('[photographer-signup] Claim executado no login', claimPayload);
              }
              photographer = await photographerService.getPhotographerById(authUser.id);
            } else {
              const claimPayload = await claimResponse.json().catch(() => null);
              const claimMessage = claimPayload?.error || claimPayload?.message || `HTTP ${claimResponse.status}`;
              claimDetail = claimPayload?.step ? `${claimMessage} (${claimPayload.step})` : claimMessage;
            }
          } catch (claimError) {
            console.warn('Não foi possível sincronizar o cadastro do fotógrafo.', claimError);
            claimDetail = claimError instanceof Error ? claimError.message : String(claimError);
          }

          if (!photographer) {
            const photographerByEmail = await photographerService.getPhotographerByEmail(loginEmail);
            if (photographerByEmail?.verified && photographerByEmail.id !== authUser.id) {
              setError(`CADASTRO APROVADO, MAS A CONTA AINDA NÃO FOI SINCRONIZADA.${claimDetail ? ` ${claimDetail}` : ''}`);
              return;
            }
            photographer = photographerByEmail;
          }
        }

        if (photographer) {
          if (!photographer.verified) {
            setError('Sua conta foi criada com sucesso e está aguardando aprovação do administrador.');
            return;
          }
          onLoginSuccess(photographer);
        } else {
          setError('Não encontramos o cadastro de fotógrafo vinculado a esta conta. Tente entrar novamente; se persistir, o cadastro pendente falhou e precisa ser reparado pelo administrador.');
        }
      }
    } catch (err: any) {
      const rawMessage = String(err?.message || 'ERRO DE CONEXAO: Tente novamente mais tarde.');
      if (rawMessage.toUpperCase().includes('EMAIL_NOT_CONFIRMED') || rawMessage.toUpperCase().includes('NOT CONFIRMED')) {
        setError('E-mail ainda não confirmado. Verifique sua caixa de entrada e o spam.');
      } else {
        setError(rawMessage);
      }
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-110 bg-brutal-white flex items-center justify-center p-6 sm:py-20 overflow-y-auto">
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
          <h1 className="font-display text-3xl md:text-4xl uppercase mb-2">STUDIO DASH</h1>
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
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Instagram (@login)</label>
                <input
                  type="text"
                  required
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  placeholder="@seunome"
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
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Telefone</label>
                <input
                  type="tel"
                  required
                  value={formatWhatsapp(phone)}
                  onChange={(e) => setPhone(formatWhatsapp(e.target.value))}
                  placeholder="(00) 90000-0000"
                  inputMode="tel"
                  maxLength={16}
                  className="w-full h-14 px-4 bg-gray-50 brutal-border font-mono text-sm focus:bg-white focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
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
            <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">E-mail corporativo</label>
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
            {!isRegistering && (
              <button
                type="button"
                onClick={handleSendPasswordSetupLink}
                disabled={isSendingPasswordLink || isLoading}
                className="font-mono text-[10px] uppercase font-bold text-brutal-accent hover:underline tracking-widest disabled:text-gray-400 disabled:no-underline"
              >
                {isSendingPasswordLink ? 'Enviando link...' : 'Primeiro acesso ou esqueci minha senha'}
              </button>
            )}
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
            {isRegistering ? 'Já tenho cadastro? Fazer login' : 'Não tem conta? Registre-se aqui'}
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
