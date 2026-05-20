import { useEffect, useState } from 'react';
import { X, Trash2, ArrowRight } from 'lucide-react';
import { Product } from '../types';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: Product[];
  onRemoveItem: (id: string) => void;
  isAuthenticated: boolean;
  onLoginRequested: () => void;
  onCheckout: (cpf: string) => void;
}

export function CartDrawer({
  isOpen,
  onClose,
  cartItems,
  onRemoveItem,
  isAuthenticated,
  onLoginRequested,
  onCheckout,
}: CartDrawerProps) {
  const [cpf, setCpf] = useState('');

  useEffect(() => {
    if (!isOpen) setCpf('');
  }, [isOpen]);

  const total = cartItems.reduce((sum, item) => sum + item.price, 0);
  const cpfValid = isValidCpf(cpf);
  const disableCheckout = cartItems.length === 0 || (isAuthenticated && !cpfValid);

  const handleCheckoutClick = () => {
    if (!isAuthenticated) {
      onLoginRequested();
      return;
    }

    if (cpfValid) onCheckout(cpf);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 transition-opacity backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-brutal-white border-l-4 border-brutal-black z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-6 border-b-4 border-brutal-black flex items-center justify-between bg-brutal-white">
          <h2 className="font-display text-3xl">SEU CARRINHO</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-brutal-accent hover:text-white brutal-border transition-colors group cursor-pointer"
            aria-label="Fechar carrinho"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col gap-8">
          {cartItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <span className="font-display text-6xl mb-4 opacity-20">0</span>
              <p className="font-mono uppercase tracking-widest text-lg">O carrinho esta vazio</p>
              <p className="font-mono text-sm mt-2 max-w-[200px]">Encontre fotos e videos para adicionar.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex gap-4 p-4 bg-brutal-white brutal-border brutal-shadow">
                    <div className="w-20 h-20 bg-gray-200 border-2 border-brutal-black overflow-hidden flex-shrink-0">
                      <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex justify-between items-start gap-3">
                          <span className="font-mono text-[9px] uppercase bg-brutal-black text-white px-1.5 py-0.5 inline-block mb-1">
                            {item.type}
                          </span>
                          <button
                            onClick={() => onRemoveItem(item.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                            aria-label="Remover item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="font-mono text-xs uppercase text-gray-800 font-bold mt-1 truncate">{item.name}</p>
                      </div>
                      <p className="font-display text-lg">R$ {item.price.toFixed(2).replace('.', ',')}</p>
                    </div>
                  </div>
                ))}
              </div>

              {isAuthenticated ? (
                <div className="bg-white p-6 brutal-border space-y-4">
                  <h3 className="font-display text-xl uppercase border-b-2 border-brutal-black pb-2">Pagamento</h3>
                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-400">CPF (obrigatorio para pagar)</label>
                    <input
                      type="text"
                      value={formatCpf(cpf)}
                      onChange={(e) => setCpf(onlyCpfDigits(e.target.value))}
                      placeholder="000.000.000-00"
                      className="w-full h-10 px-3 brutal-border-thin font-mono text-xs focus:bg-gray-50 outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-white p-6 brutal-border">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                    Faca login para finalizar a compra.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-6 border-t-4 border-brutal-black bg-brutal-white">
          <div className="flex justify-between items-end mb-6">
            <span className="font-mono text-sm uppercase text-gray-500 font-bold tracking-widest">Total</span>
            <span className="font-display text-4xl">R$ {total.toFixed(2).replace('.', ',')}</span>
          </div>
          <button
            onClick={handleCheckoutClick}
            disabled={disableCheckout}
            className={`w-full h-16 flex items-center justify-center gap-2 font-display text-2xl tracking-widest border-2 border-brutal-black transition-all ${
              disableCheckout
                ? 'opacity-50 cursor-not-allowed bg-gray-200 text-gray-400'
                : 'bg-brutal-black text-brutal-white hover:bg-brutal-accent hover:text-white brutal-shadow-hover cursor-pointer'
            }`}
          >
            <span>{isAuthenticated ? 'PAGAR COM PIX' : 'ENTRAR PARA PAGAR'}</span>
            <ArrowRight className="w-6 h-6 mt-1" />
          </button>
          {isAuthenticated && cartItems.length > 0 && !cpfValid && (
            <p className="text-[9px] font-mono uppercase text-red-500 mt-2 text-center">Informe um CPF valido para pagar</p>
          )}
        </div>
      </div>
    </>
  );
}

