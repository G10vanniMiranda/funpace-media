import { useEffect, useState } from 'react';
import { ArrowRight, CreditCard, Landmark, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { Buyer, Product } from '../types';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: Product[];
  onRemoveItem: (id: string) => void;
  isAuthenticated: boolean;
  customerName?: string | null;
  customerEmail?: string | null;
  onLoginRequested: () => void;
  onCheckout: (buyer: Buyer) => void;
}

export function CartDrawer({
  isOpen,
  onClose,
  cartItems,
  onRemoveItem,
  isAuthenticated,
  customerName,
  customerEmail,
  onLoginRequested,
  onCheckout,
}: CartDrawerProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setPhone('');
      setCpf('');
      return;
    }

    setFullName(customerName ?? '');
    setEmail(customerEmail ?? '');
  }, [isOpen, customerName, customerEmail]);

  const total = cartItems.reduce((sum, item) => sum + item.price, 0);
  const phoneDigits = phone.replace(/\D/g, '');
  const fullNameValid = fullName.trim().length >= 3;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneValid = phoneDigits.length >= 10;
  const cpfValid = isValidCpf(cpf);
  const contactValid = fullNameValid && emailValid && phoneValid && cpfValid;
  const disableCheckout = cartItems.length === 0 || (isAuthenticated && !contactValid);

  const handleCheckoutClick = () => {
    if (!isAuthenticated) {
      onLoginRequested();
      return;
    }

    if (!contactValid) return;

    onCheckout({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneDigits,
      cpf,
    });
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
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-brutal-white border-l-4 border-brutal-black z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-6 border-b-4 border-brutal-black flex items-center justify-between bg-brutal-white">
          <div>
            <h2 className="font-display text-3xl">CHECKOUT</h2>
            <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">Download digital seguro</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-brutal-accent hover:text-white brutal-border transition-colors group cursor-pointer"
            aria-label="Fechar carrinho"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col gap-6">
          {cartItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <span className="font-display text-6xl mb-4 opacity-20">0</span>
              <p className="font-mono uppercase tracking-widest text-lg">O carrinho esta vazio</p>
              <p className="font-mono text-sm mt-2 max-w-[220px]">Encontre fotos e videos para adicionar.</p>
            </div>
          ) : (
            <>
              <section className="bg-white p-5 brutal-border space-y-4">
                <div className="flex items-center justify-between border-b-2 border-brutal-black pb-2">
                  <h3 className="font-display text-xl uppercase">Resumo</h3>
                  <span className="font-mono text-[10px] uppercase text-gray-400">{cartItems.length} item(ns)</span>
                </div>

                <div className="flex flex-col gap-3">
                  {cartItems.map((item) => (
                    <div key={item.id} className="flex gap-3 p-3 bg-gray-50 brutal-border-thin">
                      <div className="w-16 h-16 bg-gray-200 border-2 border-brutal-black overflow-hidden flex-shrink-0">
                        <img src={item.thumbnailUrl || item.url} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-3">
                          <span className="font-mono text-[9px] uppercase bg-brutal-black text-white px-1.5 py-0.5">
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
                        <p className="font-mono text-xs uppercase text-gray-800 font-bold mt-2 truncate">{item.name}</p>
                        <p className="font-display text-lg mt-1">R$ {item.price.toFixed(2).replace('.', ',')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {isAuthenticated ? (
                <>
                  <section className="bg-white p-5 brutal-border space-y-4">
                    <div className="flex items-center justify-between border-b-2 border-brutal-black pb-2">
                      <h3 className="font-display text-xl uppercase">Contato</h3>
                      <span className="font-mono text-[10px] uppercase text-gray-400">Etapa 1 de 2</span>
                    </div>

                    <CheckoutInput
                      label="Nome completo"
                      value={fullName}
                      onChange={setFullName}
                      placeholder="Seu nome"
                    />
                    <CheckoutInput
                      label="E-mail para liberar o download"
                      value={email}
                      onChange={setEmail}
                      placeholder="seu@email.com"
                      type="email"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <CheckoutInput
                        label="WhatsApp"
                        value={phone}
                        onChange={(value) => setPhone(value.replace(/[^\d\s()+-]/g, '').slice(0, 20))}
                        placeholder="(00) 00000-0000"
                        type="tel"
                      />
                      <CheckoutInput
                        label="CPF"
                        value={formatCpf(cpf)}
                        onChange={(value) => setCpf(onlyCpfDigits(value))}
                        placeholder="000.000.000-00"
                      />
                    </div>

                    <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500">
                      Nada de endereco de entrega. Estes dados identificam o pedido e liberam os arquivos digitais apos a confirmacao.
                    </p>
                  </section>

                  <section className="bg-white p-5 brutal-border space-y-4">
                    <div className="flex items-center justify-between border-b-2 border-brutal-black pb-2">
                      <h3 className="font-display text-xl uppercase">Pagamento</h3>
                      <span className="font-mono text-[10px] uppercase text-gray-400">Etapa 2 de 2</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <PaymentBadge icon={<Smartphone className="w-4 h-4" />} label="Pix" />
                      <PaymentBadge icon={<CreditCard className="w-4 h-4" />} label="Credito" />
                      <PaymentBadge icon={<Landmark className="w-4 h-4" />} label="Debito" />
                    </div>

                    <div className="bg-gray-50 brutal-border-thin p-3 flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-brutal-accent shrink-0 mt-0.5" />
                      <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500">
                        O pagamento e processado pela InfinitePay. A Funpace nao armazena dados de cartao.
                      </p>
                    </div>
                  </section>
                </>
              ) : (
                <div className="bg-white p-6 brutal-border">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                    Faca login para finalizar a compra e receber seus downloads.
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
            className={`w-full h-16 flex items-center justify-center gap-2 font-display text-xl sm:text-2xl tracking-widest border-2 border-brutal-black transition-all ${
              disableCheckout
                ? 'opacity-50 cursor-not-allowed bg-gray-200 text-gray-400'
                : 'bg-brutal-black text-brutal-white hover:bg-brutal-accent hover:text-white brutal-shadow-hover cursor-pointer'
            }`}
          >
            <span>{isAuthenticated ? 'IR PARA PAGAMENTO' : 'ENTRAR PARA PAGAR'}</span>
            <ArrowRight className="w-6 h-6 mt-1" />
          </button>
          {isAuthenticated && cartItems.length > 0 && !contactValid && (
            <p className="text-[9px] font-mono uppercase text-red-500 mt-2 text-center">
              Preencha nome, e-mail, WhatsApp e CPF validos
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function CheckoutInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase font-bold text-gray-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-11 px-3 brutal-border-thin font-mono text-xs focus:bg-gray-50 outline-none"
      />
    </div>
  );
}

function PaymentBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="h-12 brutal-border-thin bg-gray-50 flex flex-col items-center justify-center gap-1">
      <span className="text-brutal-accent">{icon}</span>
      <span className="font-mono text-[9px] uppercase font-bold tracking-tight text-gray-600">{label}</span>
    </div>
  );
}
