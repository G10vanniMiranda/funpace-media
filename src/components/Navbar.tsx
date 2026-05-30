import { ShoppingCart, User, Search, Camera, LogOut, X, Menu, LayoutDashboard } from 'lucide-react';
import React, { useState, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { logout } from '../lib/supabase';

interface NavbarProps {
  cartItemCount: number;
  onOpenCart: () => void;
  onNavigateHome: () => void;
  onOpenAuth: () => void;
  onSearch: (bib: string) => void;
  onOpenDashboard: () => void;
  onOpenOrders: () => void;
  onOpenAccount?: () => void;
}

function titleCaseFromEmail(email: string) {
  const local = (email.split('@')[0] || '').trim();
  if (!local) return '';
  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function Navbar({ cartItemCount, onOpenCart, onNavigateHome, onOpenAuth, onSearch, onOpenDashboard, onOpenOrders, onOpenAccount }: NavbarProps) {
  const { user } = useAuth();
  const [isSearching, setIsSearching] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const userLabel = user
    ? (user.isAdmin
      ? 'ADMIN'
      : (user.displayName || (user.email ? titleCaseFromEmail(user.email) : '') || 'CONTA'))
    : '';

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
      setIsSearching(false);
      setIsMenuOpen(false);
      setSearchQuery('');
    }
  };

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <nav className="sticky top-0 z-50 bg-brutal-black text-brutal-white border-b-4 border-brutal-black px-4 md:px-6 py-4 flex items-center justify-between">
      <div
        className="flex items-center gap-2 cursor-pointer group"
        onClick={() => {
          onNavigateHome();
          setIsMenuOpen(false);
        }}
      >
        <Camera className="w-6 h-6 md:w-8 md:h-8 group-hover:text-brutal-accent transition-colors" />
        <span className="font-display text-lg md:text-2xl tracking-tighter mt-1 group-hover:text-brutal-accent transition-colors inline-block">
          FUNPACE MEDIA
        </span>
      </div>

      <div className="hidden md:flex items-center gap-6">
        <button
          onClick={onOpenDashboard}
          className="bg-brutal-black text-white px-4 py-2 brutal-border font-mono text-[10px] uppercase font-bold hover:bg-brutal-accent transition-colors cursor-pointer"
        >
          Área do Fotógrafo
        </button>

        {isSearching ? (
          <motion.form
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            onSubmit={handleSearchSubmit}
            className="flex items-center gap-2"
          >
            <input
              autoFocus
              type="text"
              placeholder="Nº DO PEITO"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white text-brutal-black px-4 py-1 font-mono text-sm brutal-border focus:outline-none w-32 md:w-48"
            />
            <button
              type="button"
              onClick={() => setIsSearching(false)}
              className="text-white hover:text-brutal-accent transition-colors cursor-pointer p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.form>
        ) : (
          <button
            onClick={() => setIsSearching(true)}
            className="flex items-center gap-2 hover:text-brutal-accent font-mono text-sm uppercase transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>Buscar Fotos</span>
          </button>
        )}

        {user ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {user.photoURL ? (
                <img src={user.photoURL} alt={userLabel} className="w-8 h-8 rounded-full brutal-border" />
              ) : (
                <div className="w-8 h-8 bg-brutal-accent flex items-center justify-center rounded-full font-display text-xs">
                  {userLabel?.[0]}
                </div>
              )}
              <span className="hidden lg:inline font-mono text-xs uppercase tracking-widest">{userLabel}</span>
            </div>
            <button
              onClick={onOpenAccount || onOpenOrders}
              className="flex items-center gap-2 hover:text-brutal-accent font-mono text-sm uppercase transition-colors cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Conta</span>
            </button>
            <button
              onClick={() => logout()}
              className="hover:text-brutal-accent transition-colors cursor-pointer"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-2 hover:text-brutal-accent font-mono text-sm uppercase transition-colors cursor-pointer"
          >
            <User className="w-4 h-4" />
            <span>Entrar</span>
          </button>
        )}

        <button
          onClick={onOpenCart}
          className="flex items-center gap-2 bg-brutal-white text-brutal-black px-4 py-2 brutal-border hover:bg-brutal-accent hover:text-brutal-white transition-colors relative"
        >
          <ShoppingCart className="w-4 h-4" />
          <span className="font-display mt-0.5 text-sm">CARRINHO</span>
          {cartItemCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-brutal-accent text-brutal-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-mono font-bold">
              {cartItemCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex md:hidden items-center gap-4">
        <button
          onClick={onOpenCart}
          className="relative p-2 hover:text-brutal-accent transition-colors cursor-pointer"
          aria-label="Abrir carrinho"
        >
          <ShoppingCart className="w-6 h-6" />
          {cartItemCount > 0 && (
            <span className="absolute top-0 right-0 bg-brutal-accent text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">
              {cartItemCount}
            </span>
          )}
        </button>
        <button
          onClick={toggleMenu}
          className="p-2 hover:text-brutal-accent transition-colors cursor-pointer"
          aria-label={isMenuOpen ? 'Fechar menu' : 'Abrir menu'}
        >
          {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-brutal-black/80 backdrop-blur-sm z-55 md:hidden"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 h-full w-[86%] max-w-90 bg-brutal-white z-60 md:hidden brutal-border-l"
            >
              <div className="flex h-full flex-col text-brutal-black">
                <div className="border-b-2 border-brutal-black px-5 py-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">Funpace Media</p>
                      <span className="font-display text-2xl tracking-normal">Menu</span>
                    </div>
                    <button
                      onClick={() => setIsMenuOpen(false)}
                      className="grid h-10 w-10 shrink-0 place-items-center brutal-border bg-white hover:bg-gray-50 transition-colors cursor-pointer"
                      aria-label="Fechar menu"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-6">
                  <div className="space-y-7">
                    <section className="space-y-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">Acesso</p>
                      <button
                        onClick={() => {
                          onOpenDashboard();
                          setIsMenuOpen(false);
                        }}
                        className="w-full min-h-12 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2 px-4"
                      >
                        <Camera className="w-4 h-4" />
                        Painel do Fotógrafo
                      </button>
                    </section>

                    <section className="space-y-4 border-t-2 border-dashed border-gray-200 pt-6">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">Busca</p>
                        <h4 className="mt-1 font-display text-xl uppercase tracking-normal">Encontre suas fotos</h4>
                      </div>

                      <form onSubmit={handleSearchSubmit} className="flex items-stretch">
                        <input
                          type="text"
                          placeholder="BUSCAR .."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="min-w-0 flex-1 bg-white text-brutal-black px-4 h-12 font-mono text-sm brutal-border border-r-0 focus:outline-none focus:bg-gray-50 placeholder:text-gray-400"
                        />
                        <button
                          type="submit"
                          className="bg-brutal-black text-white w-14 h-12 brutal-border cursor-pointer hover:bg-brutal-accent transition-colors shrink-0 inline-flex items-center justify-center"
                          aria-label="Buscar fotos"
                        >
                          <Search className="w-5 h-5" />
                        </button>
                      </form>

                    </section>

                    <section className="border-t-2 border-dashed border-gray-200 pt-6">
                      {user ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-3 bg-gray-50 brutal-border p-3">
                            {user.photoURL ? (
                              <img src={user.photoURL} alt={userLabel} className="w-10 h-10 rounded-full brutal-border" />
                            ) : (
                              <div className="w-10 h-10 bg-brutal-accent flex items-center justify-center rounded-full font-display text-sm text-white">
                                {userLabel?.[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex flex-col">
                              <span className="font-display text-sm uppercase truncate">{userLabel}</span>
                              <span className="font-mono text-[10px] text-gray-500 truncate">{user.email}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              (onOpenAccount || onOpenOrders)();
                              setIsMenuOpen(false);
                            }}
                            className="w-full min-h-12 brutal-border flex items-center justify-center gap-2 font-mono text-sm uppercase hover:bg-gray-50 transition-colors cursor-pointer px-4"
                          >
                            <LayoutDashboard className="w-4 h-4" />
                            Minha Conta
                          </button>
                          <button
                            onClick={() => {
                              logout();
                              setIsMenuOpen(false);
                            }}
                            className="w-full min-h-12 brutal-border flex items-center justify-center gap-2 font-mono text-sm uppercase hover:bg-red-50 text-red-500 transition-colors cursor-pointer px-4"
                          >
                            <LogOut className="w-4 h-4" />
                            Sair da Conta
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            onOpenAuth();
                            setIsMenuOpen(false);
                          }}
                          className="w-full min-h-13 bg-brutal-accent text-white brutal-border brutal-shadow flex items-center justify-center gap-2 font-display text-sm tracking-widest hover:bg-brutal-black transition-colors cursor-pointer px-4 py-3"
                        >
                          <User className="w-5 h-5" />
                          Entrar / Cadastrar
                        </button>
                      )}
                    </section>
                  </div>
                </div>

                <div className="border-t-2 border-brutal-black px-5 py-4">
                  <p className="font-mono text-[10px] text-center text-gray-400 uppercase tracking-widest">
                    Funpace Media © 2026
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
}
