import { useState, FormEvent } from 'react';
import { Mail, Lock, User, ArrowRight, X, Loader2 } from 'lucide-react';
import { isValidAuthEmail, loginWithEmail, normalizeAuthEmail, registerWithEmail, loginWithGoogle, requestPasswordReset, resendSignupConfirmation } from '../lib/supabase';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';
import { formatWhatsapp, onlyWhatsappDigits } from '../lib/phone';
import { motion, AnimatePresence } from 'motion/react';
import { isGoogleAuthEnabled, isMockMode } from '../lib/config';

interface AuthViewProps {
  onClose: () => void;
  onSuccess: () => void;
}

type AuthMode = 'login' | 'register';

export function AuthView({ onClose, onSuccess }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string; name?: string; phone?: string; cpf?: string }>({});
  const [loading, setLoading] = useState(false);

  const validateFields = () => {
    const nextErrors: typeof fieldError = {};
    const normalizedEmail = normalizeAuthEmail(email);

    if (!isValidAuthEmail(normalizedEmail)) {
      nextErrors.email = 'Digite um e-mail valido, como nome@gmail.com.';
    }
    if (!password || password.length < 6) {
      nextErrors.password = 'Use pelo menos 6 caracteres.';
    }
    if (mode === 'register') {
      if (!name.trim()) nextErrors.name = 'Informe seu nome completo.';
      const phoneDigits = onlyWhatsappDigits(phone);
      if (phoneDigits.length < 10) nextErrors.phone = 'Informe um WhatsApp valido.';
      if (cpf && !isValidCpf(cpf)) nextErrors.cpf = 'CPF invalido.';
    }

    setFieldError(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setFieldError({});
    setPendingConfirmationEmail(null);

    if (!validateFields()) return;

    setLoading(true);

    try {
      const normalizedEmail = normalizeAuthEmail(email);
      if (mode === 'login') {
        await loginWithEmail(normalizedEmail, password);
        onSuccess();
      } else {
        const phoneDigits = onlyWhatsappDigits(phone);
        const createdUser = await registerWithEmail(normalizedEmail, password, name.trim(), onlyCpfDigits(cpf), phoneDigits);
        if (!createdUser?.id) {
          setPendingConfirmationEmail(normalizedEmail);
          setMessage('Conta criada. Confirme seu e-mail para entrar e continuar a compra. Seu carrinho foi mantido.');
          return;
        }
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError('Informe seu e-mail para recuperar a senha.');
      return;
    }
    const normalizedEmail = normalizeAuthEmail(email);
    if (!isValidAuthEmail(normalizedEmail)) {
      setFieldError({ email: 'Digite um e-mail valido, como nome@gmail.com.' });
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(normalizedEmail);
      setMessage('Enviamos um link de recuperacao para seu e-mail.');
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel enviar a recuperacao de senha.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    const normalizedEmail = normalizeAuthEmail(pendingConfirmationEmail || email);
    setError(null);
    setMessage(null);
    if (!isValidAuthEmail(normalizedEmail)) {
      setFieldError({ email: 'Digite um e-mail valido para reenviar a confirmacao.' });
      return;
    }

    setLoading(true);
    try {
      await resendSignupConfirmation(normalizedEmail);
      setPendingConfirmationEmail(normalizedEmail);
      setMessage('Reenviamos a confirmacao. Confira a caixa de entrada e o spam.');
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel reenviar a confirmacao.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);

    try {
      await loginWithGoogle();
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel entrar com Google.');
      setLoading(false);
    }
  };

  const googleEnabled = !isMockMode && isGoogleAuthEnabled;
  const toggleMode = () => {
    setMode((current) => current === 'login' ? 'register' : 'login');
    setError(null);
    setMessage(null);
    setFieldError({});
    setPendingConfirmationEmail(null);
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brutal-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="relative w-full max-w-md bg-brutal-white brutal-border brutal-shadow p-8"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-8">
          <h2 className="font-display text-4xl mb-2">
            {mode === 'login' ? 'ENTRAR' : 'CRIAR CONTA'}
          </h2>
          <p className="font-mono text-sm uppercase tracking-widest text-gray-500">
            {mode === 'login' ? 'Bem-vindo de volta, corredor.' : 'Junte-se a nossa comunidade.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence mode="wait">
            {mode === 'register' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-widest font-bold">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setFieldError((current) => ({ ...current, name: undefined }));
                      }}
                      className={`w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm ${fieldError.name ? 'border-red-500' : ''}`}
                      placeholder="CORREDOR RELAMPAGO"
                    />
                  </div>
                  {fieldError.name && <p className="font-mono text-[10px] uppercase text-red-600">{fieldError.name}</p>}
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-widest font-bold">Telefone</label>
                  <input
                    type="tel"
                    value={formatWhatsapp(phone)}
                    onChange={(e) => {
                      setPhone(formatWhatsapp(e.target.value));
                      setFieldError((current) => ({ ...current, phone: undefined }));
                    }}
                    className={`w-full h-14 px-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm ${fieldError.phone ? 'border-red-500' : ''}`}
                    placeholder="(00) 90000-0000"
                    inputMode="tel"
                    maxLength={16}
                    required
                  />
                  {fieldError.phone && <p className="font-mono text-[10px] uppercase text-red-600">{fieldError.phone}</p>}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-widest font-bold">CPF Opcional</label>
                  <input
                    type="text"
                    value={formatCpf(cpf)}
                    onChange={(e) => {
                      setCpf(onlyCpfDigits(e.target.value));
                      setFieldError((current) => ({ ...current, cpf: undefined }));
                    }}
                    className={`w-full h-14 px-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm ${fieldError.cpf ? 'border-red-500' : ''}`}
                    placeholder="000.000.000-00"
                  />
                  {fieldError.cpf && <p className="font-mono text-[10px] uppercase text-red-600">{fieldError.cpf}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-widest font-bold">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldError((current) => ({ ...current, email: undefined }));
                }}
                onBlur={() => setEmail(normalizeAuthEmail(email))}
                className={`w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm ${fieldError.email ? 'border-red-500' : ''}`}
                placeholder="seu@email.com"
              />
            </div>
            {fieldError.email && <p className="font-mono text-[10px] uppercase text-red-600">{fieldError.email}</p>}
          </div>

          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-widest font-bold">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                required
                value={password}
                minLength={6}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldError((current) => ({ ...current, password: undefined }));
                }}
                className={`w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm ${fieldError.password ? 'border-red-500' : ''}`}
                placeholder="********"
              />
            </div>
            {fieldError.password && <p className="font-mono text-[10px] uppercase text-red-600">{fieldError.password}</p>}
          </div>

          {error && (
            <p className="bg-red-100 border-l-4 border-red-500 p-3 text-red-700 font-mono text-xs uppercase">
              {error}
            </p>
          )}

          {message && (
            <p className="bg-green-100 border-l-4 border-green-500 p-3 text-green-700 font-mono text-xs uppercase">
              {message}
            </p>
          )}

          {pendingConfirmationEmail && (
            <div className="bg-yellow-50 border-l-4 border-yellow-500 p-3 space-y-3">
              <p className="text-yellow-800 font-mono text-xs uppercase leading-relaxed">
                Depois de confirmar o e-mail, volte aqui e use Entrar. Seu carrinho continua salvo.
              </p>
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={loading}
                className="min-h-10 w-full bg-white brutal-border font-display text-xs uppercase tracking-widest hover:bg-yellow-100 disabled:opacity-60"
              >
                Reenviar confirmacao
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-brutal-black text-white hover:bg-brutal-accent transition-all flex items-center justify-center gap-2 brutal-shadow-hover cursor-pointer group disabled:opacity-70 disabled:cursor-wait"
          >
            <span className="font-display text-xl tracking-widest">
              {loading ? 'PROCESSANDO...' : mode === 'login' ? 'ENTRAR' : 'CADASTRAR'}
            </span>
            {!loading && <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={loading}
              className="w-full text-center font-mono text-[10px] uppercase tracking-widest text-gray-500 hover:text-brutal-accent cursor-pointer disabled:cursor-wait"
            >
              Esqueci minha senha
            </button>
          )}

          {googleEnabled && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">ou</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="w-full h-14 bg-white text-[#3c4043] border border-[#dadce0] hover:bg-[#f8fafd] hover:border-[#d2e3fc] transition-all flex items-center justify-center gap-3 cursor-pointer disabled:opacity-70 disabled:cursor-wait font-sans"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#5f6368]" />
                ) : (
                  <GoogleLogo />
                )}
                <span className="text-sm font-semibold tracking-normal">
                  {mode === 'login' ? 'Entrar com Google' : 'Cadastrar com Google'}
                </span>
              </button>
            </div>
          )}
        </form>

        <p className="mt-8 text-center font-mono text-xs uppercase tracking-widest">
          {mode === 'login' ? 'Nao tem uma conta?' : 'Ja possui conta?'}
          <button
            onClick={toggleMode}
            className="ml-2 text-brutal-accent font-bold hover:underline cursor-pointer"
          >
            {mode === 'login' ? 'Crie agora' : 'Entre aqui'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C4 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 4 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
