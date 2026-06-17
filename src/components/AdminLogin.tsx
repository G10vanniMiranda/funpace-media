import React, { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, Lock, Mail, ArrowRight, Loader2, AlertCircle, Terminal } from 'lucide-react';
import { isMockMode } from '../lib/config';
import { loginWithEmail, logout } from '../lib/supabase';

interface AdminLoginProps {
  onLoginSuccess: () => void;
  onBack: () => void;
}

export function AdminLogin({ onLoginSuccess, onBack }: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isMockMode) {
        if (email.trim()) {
          onLoginSuccess();
        } else {
          setError('Informe um e-mail para acessar o admin mock.');
        }
        return;
      }

      const user = await loginWithEmail(email, password);

      if (user?.isAdmin) {
        onLoginSuccess();
      } else {
        await logout();
        setError('ACESSO RESTRITO: usuário autenticado não possui permissão de administrador.');
      }
    } catch (err: any) {
      setError(err?.message || 'ACESSO RESTRITO: credenciais invalidas para o Painel Administrativo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-120 bg-brutal-black flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.03]">
        <div className="grid grid-cols-12 gap-2 p-2">
          {Array(144).fill(0).map((_, i) => (
            <Terminal key={i} className="w-full h-auto text-white" />
          ))}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md bg-brutal-white brutal-border brutal-shadow-heavy p-8 md:p-12"
      >
        <button
          onClick={onBack}
          className="absolute -top-12 left-0 font-mono text-xs uppercase tracking-widest text-gray-400 hover:text-brutal-accent transition-colors flex items-center gap-2 cursor-pointer"
        >
          Voltar ao Inicio
        </button>

        <div className="text-center mb-10">
          <div className="inline-block bg-brutal-black text-white p-4 brutal-border mb-6">
            <ShieldCheck className="w-8 h-8 text-brutal-accent" />
          </div>
          <h1 className="font-display text-4xl tracking-tighter uppercase mb-2">SYSTEM ADMIN</h1>
          <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest leading-none">Acesso restrito a administradores</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">E-mail Admin</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@exemplo.com"
                className="w-full h-14 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="w-full h-14 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none transition-all"
              />
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red-50 border-2 border-red-500 p-4 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="font-mono text-[10px] text-red-600 font-bold uppercase leading-tight">{error}</p>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-16 bg-brutal-black text-white brutal-border font-display text-xl uppercase tracking-widest hover:bg-brutal-accent transition-all flex items-center justify-center gap-3 group cursor-pointer disabled:opacity-70"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : (
              <>
                Confirmar Identidade
                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
