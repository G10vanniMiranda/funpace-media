import { useState, FormEvent } from 'react';
import { Mail, Lock, User, ArrowRight, X, Loader2 } from 'lucide-react';
import { loginWithEmail, registerWithEmail, loginWithGoogle } from '../lib/supabase';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';
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
  const [cpf, setCpf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        if (!name.trim()) throw new Error('Por favor, informe seu nome.');
        if (cpf && !isValidCpf(cpf)) throw new Error('CPF invalido.');
        await registerWithEmail(email, password, name, onlyCpfDigits(cpf));
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro. Tente novamente.');
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
                      onChange={(e) => setName(e.target.value)}
                      className="w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm"
                      placeholder="CORREDOR RELAMPAGO"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-widest font-bold">CPF Opcional</label>
                  <input 
                    type="text"
                    value={formatCpf(cpf)}
                    onChange={(e) => setCpf(onlyCpfDigits(e.target.value))}
                    className="w-full h-14 px-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm"
                    placeholder="000.000.000-00"
                  />
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
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm"
                placeholder="SEU@EMAIL.COM"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-widest font-bold">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-white brutal-border focus:border-brutal-accent transition-colors outline-none font-mono text-sm"
                placeholder="********"
              />
            </div>
          </div>

          {error && (
            <p className="bg-red-100 border-l-4 border-red-500 p-3 text-red-700 font-mono text-xs uppercase">
              {error}
            </p>
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
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
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
