import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, CreditCard, ExternalLink, Image as ImageIcon, Loader2, QrCode, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { Buyer, Product } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';
import { formatWhatsapp, onlyWhatsappDigits } from '../lib/phone';
import { ProtectedMedia } from './ProtectedMedia';
import { CheckoutPaymentMethod, CreateCheckoutResult } from '../lib/services';

interface CheckoutPageProps {
  cartItems: Product[];
  onRemoveItem: (id: string) => void;
  onCheckout: (buyer: Buyer, paymentMethod: CheckoutPaymentMethod) => Promise<CreateCheckoutResult>;
  onLoginRequested: () => void;
}

const MIN_CHECKOUT_TOTAL = 1;

function publicMediaUrl(rawPathOrUrl?: string | null) {
  const value = rawPathOrUrl || '';
  if (!value || /^blob:/i.test(value) || /^data:/i.test(value) || /^https?:\/\//i.test(value)) return value;

  const mediaBaseUrl = import.meta.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${String(mediaBaseUrl).replace(/\/+$/, '')}/${encodeURI(value.replace(/^\/+/, ''))}`;
  }

  return value;
}

function getProductPreviewUrl(item: Product) {
  return publicMediaUrl(item.thumbnailUrl || item.url);
}

function titleCaseFromEmail(email?: string | null) {
  const local = (email?.split('@')[0] || '').trim();
  if (!local) return '';
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function CheckoutPage({ cartItems, onRemoveItem, onCheckout, onLoginRequested }: CheckoutPageProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(user?.displayName || titleCaseFromEmail(user?.email));
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [submittingMethod, setSubmittingMethod] = useState<CheckoutPaymentMethod | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CreateCheckoutResult | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  useEffect(() => {
    setFullName(user?.displayName || titleCaseFromEmail(user?.email));
    setEmail(user?.email ?? '');
  }, [user?.displayName, user?.email]);

  const total = useMemo(() => cartItems.reduce((sum, item) => sum + Number(item.price || 0), 0), [cartItems]);
  const meetsMinimumTotal = total > MIN_CHECKOUT_TOTAL;
  const phoneDigits = onlyWhatsappDigits(phone);
  const contactValid = fullName.trim().length >= 3 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    phoneDigits.length >= 10 &&
    isValidCpf(cpf);
  const isSubmitting = Boolean(submittingMethod);
  const canPay = cartItems.length > 0 && Boolean(user) && contactValid && meetsMinimumTotal && !isSubmitting;

  const handlePay = async (paymentMethod: CheckoutPaymentMethod) => {
    if (!user) {
      onLoginRequested();
      return;
    }

    if (!contactValid) return;

    setSubmittingMethod(paymentMethod);
    setCheckoutResult(null);
    try {
      const result = await onCheckout({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phoneDigits,
        cpf,
      }, paymentMethod);

      setCheckoutResult(result);
      if (paymentMethod !== 'pix' || !result.pix?.qrCode) {
        window.location.href = result.paymentUrl;
      }
    } finally {
      setSubmittingMethod(null);
    }
  };

  const copyPixCode = async () => {
    const code = checkoutResult?.pix?.qrCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedPix(true);
    window.setTimeout(() => setCopiedPix(false), 1800);
  };

  return (
    <main className="min-h-screen bg-brutal-white text-brutal-black">
      <div className="border-b-4 border-brutal-black bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gray-500 hover:text-brutal-accent cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para loja
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400">Checkout seguro</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">
        <section className="space-y-8">
          <div>
            <h1 className="font-display text-5xl md:text-7xl uppercase tracking-tighter">Finalizar Compra</h1>
            <p className="font-mono text-sm uppercase tracking-widest text-gray-500 mt-2">
              Fotos e videos digitais liberados apos confirmacao do pagamento.
            </p>
          </div>

          {!user && (
            <div className="bg-white brutal-border p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl uppercase">Entre para continuar</h2>
                <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
                  Seu e-mail sera usado para liberar os downloads comprados.
                </p>
              </div>
              <button
                onClick={onLoginRequested}
                className="h-12 px-6 bg-brutal-black text-white brutal-border font-display text-lg uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer"
              >
                Entrar
              </button>
            </div>
          )}

          <section className="bg-white brutal-border p-6 space-y-5">
            <div className="flex items-center justify-between border-b-2 border-brutal-black pb-3">
              <h2 className="font-display text-2xl uppercase">Contato</h2>
              <span className="font-mono text-[10px] uppercase text-gray-400">Etapa 1 de 2</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckoutInput label="Nome completo" value={fullName} onChange={setFullName} placeholder="Seu nome" />
              <CheckoutInput label="E-mail para liberar download" value={email} onChange={setEmail} placeholder="seu@email.com" type="email" />
              <CheckoutInput
                label="WhatsApp"
                value={phone}
                onChange={(value) => setPhone(formatWhatsapp(value))}
                placeholder="(00) 00000-0000"
                type="tel"
                inputMode="numeric"
                maxLength={15}
              />
              <CheckoutInput label="CPF" value={formatCpf(cpf)} onChange={(value) => setCpf(onlyCpfDigits(value))} placeholder="000.000.000-00" inputMode="numeric" maxLength={14} />
            </div>
          </section>

          <section className="bg-white brutal-border p-6 space-y-5">
            <div className="flex items-center justify-between border-b-2 border-brutal-black pb-3">
              <h2 className="font-display text-2xl uppercase">Pagamento</h2>
              <span className="font-mono text-[10px] uppercase text-gray-400">Etapa 2 de 2</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PaymentAction
                icon={<Smartphone className="w-5 h-5" />}
                title="Pagar com PIX"
                detail="Confirmacao automatica via InfinitePay"
                disabled={!canPay}
                loading={submittingMethod === 'pix'}
                onClick={() => handlePay('pix')}
              />
              <PaymentAction
                icon={<CreditCard className="w-5 h-5" />}
                title="Pagar com cartao"
                detail="Credito, e debito se disponivel no checkout"
                disabled={!canPay}
                loading={submittingMethod === 'credit_card'}
                onClick={() => handlePay('credit_card')}
              />
            </div>
            {checkoutResult?.paymentMethod === 'pix' && (
              <div className="bg-white brutal-border p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <QrCode className="w-5 h-5 text-brutal-accent shrink-0" />
                  <div>
                    <p className="font-display text-xl uppercase">PIX aguardando pagamento</p>
                    <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500">
                      Quando a InfinitePay confirmar o pagamento, os downloads serao liberados automaticamente.
                    </p>
                  </div>
                </div>
                {checkoutResult.pix?.qrCodeImage && (
                  <img src={checkoutResult.pix.qrCodeImage} alt="QR Code PIX" className="mx-auto h-48 w-48 object-contain brutal-border-thin bg-white p-2" />
                )}
                {checkoutResult.pix?.qrCode ? (
                  <>
                    <textarea
                      readOnly
                      value={checkoutResult.pix.qrCode}
                      className="h-24 w-full resize-none brutal-border-thin bg-gray-50 p-3 font-mono text-[10px] uppercase outline-none"
                    />
                    <button
                      type="button"
                      onClick={copyPixCode}
                      className="min-h-11 w-full bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      {copiedPix ? 'Codigo copiado' : 'Copiar codigo PIX'}
                    </button>
                  </>
                ) : (
                  <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500">
                    Este retorno da InfinitePay nao trouxe QR Code direto. Abra o ambiente seguro para concluir com PIX.
                  </p>
                )}
                {checkoutResult.paymentUrl && (
                  <a
                    href={checkoutResult.paymentUrl}
                    className="min-h-11 w-full bg-white text-brutal-black brutal-border font-display text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    Abrir checkout seguro
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
            <div className="bg-gray-50 brutal-border-thin p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-brutal-accent shrink-0 mt-0.5" />
              <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-500">
                O pagamento acontece na InfinitePay. A Funpace nao armazena dados de cartao e nao solicita endereco de entrega.
              </p>
            </div>
          </section>
        </section>

        <aside className="lg:sticky lg:top-6 h-fit bg-white brutal-border brutal-shadow p-6 space-y-5">
          <div className="flex items-center justify-between border-b-2 border-brutal-black pb-3">
            <h2 className="font-display text-2xl uppercase">Pedido</h2>
            <span className="font-mono text-[10px] uppercase text-gray-400">{cartItems.length} item(ns)</span>
          </div>

          {cartItems.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-display text-2xl uppercase">Carrinho vazio</p>
              <button onClick={() => navigate('/')} className="mt-4 font-mono text-xs uppercase text-brutal-accent font-bold cursor-pointer">
                Escolher midias
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
              {cartItems.map((item) => (
                <div key={item.id} className="flex gap-3 bg-gray-50 brutal-border-thin p-3">
                  <ProductThumbnail item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-mono text-xs uppercase font-bold truncate">{item.name}</p>
                      <button onClick={() => onRemoveItem(item.id)} className="text-gray-400 hover:text-red-500 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="font-mono text-[9px] uppercase text-gray-400 mt-1">{item.type} - {item.event}</p>
                    <p className="font-display text-xl mt-1">R$ {Number(item.price).toFixed(2).replace('.', ',')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t-2 border-brutal-black pt-5 space-y-3">
            <div className="flex justify-between font-mono text-xs uppercase text-gray-500">
              <span>Subtotal</span>
              <span>R$ {total.toFixed(2).replace('.', ',')}</span>
            </div>
            <div className="flex justify-between font-mono text-xs uppercase text-gray-500">
              <span>Descontos</span>
              <span>R$ 0,00</span>
            </div>
            <div className="flex justify-between font-mono text-xs uppercase text-gray-500">
              <span>Entrega</span>
              <span>Digital</span>
            </div>
            <div className="flex justify-between items-end pt-3">
              <span className="font-mono text-sm uppercase text-gray-500 font-bold tracking-widest">Total</span>
              <span className="font-display text-4xl">R$ {total.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>

          <button
            onClick={() => handlePay('checkout')}
            disabled={!canPay}
            className={`w-full h-16 flex items-center justify-center gap-2 font-display text-xl tracking-widest border-2 border-brutal-black transition-all ${
              canPay
                ? 'bg-brutal-black text-white hover:bg-brutal-accent brutal-shadow-hover cursor-pointer'
                : 'bg-gray-200 text-gray-400 opacity-70 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <span>FINALIZAR COMPRA</span>}
            {!isSubmitting && <ArrowRight className="w-6 h-6 mt-1" />}
          </button>
          {user && cartItems.length > 0 && !contactValid && (
            <p className="font-mono text-[9px] uppercase text-red-500 text-center">Preencha nome, e-mail, WhatsApp e CPF validos.</p>
          )}
          {cartItems.length > 0 && !meetsMinimumTotal && (
            <p className="font-mono text-[9px] uppercase text-red-500 text-center">
              A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function ProductThumbnail({ item }: { item: Product }) {
  const [failed, setFailed] = useState(false);
  const previewUrl = getProductPreviewUrl(item);

  return (
    <div className="w-16 h-16 brutal-border-thin overflow-hidden bg-gray-100 shrink-0">
      {previewUrl && !failed ? (
        <ProtectedMedia
          src={previewUrl}
          alt={item.name}
          type={item.type}
          watermark={`FUNPACE ${item.bib || item.id.slice(0, 6)}`}
          imgClassName="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400">
          <ImageIcon className="w-5 h-5" />
        </div>
      )}
    </div>
  );
}

function CheckoutInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm focus:bg-gray-50 outline-none"
      />
    </div>
  );
}

function PaymentAction({
  icon,
  title,
  detail,
  disabled,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-24 brutal-border-thin p-4 text-left transition-colors ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-gray-50 cursor-pointer'}`}
    >
      <span className="mb-3 inline-flex text-brutal-accent">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}</span>
      <span className="block font-display text-lg uppercase">{title}</span>
      <span className="mt-1 block font-mono text-[10px] uppercase leading-relaxed text-gray-500">{detail}</span>
    </button>
  );
}
