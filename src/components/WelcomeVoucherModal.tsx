import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Gift, Sparkles, X } from 'lucide-react';
import { orderService } from '../lib/services';
import { useToast } from '../contexts/ToastContext';
import {
  WELCOME_VOUCHER_CODE,
  dismissWelcomeVoucher,
  hasActiveWelcomeVoucherDismissal,
  recordWelcomeVoucherEvent,
  saveWelcomeVoucherForCheckout,
} from '../lib/welcome-voucher';

interface WelcomeVoucherModalProps {
  userId?: string | null;
  onStartShopping: () => void;
}

function hasPaidOrderOrVoucherUse(orders: Awaited<ReturnType<typeof orderService.getCustomerOrders>>) {
  return orders.some((order) => {
    const status = String(order.status || '').toLowerCase();
    const couponCode = String((order as any).couponCode || '').toUpperCase();
    return status === 'paid' || couponCode === WELCOME_VOUCHER_CODE;
  });
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function WelcomeVoucherModal({ userId, onStartShopping }: WelcomeVoucherModalProps) {
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = React.useState(false);
  const [checkingEligibility, setCheckingEligibility] = React.useState(true);
  const viewedRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    async function checkEligibility() {
      setCheckingEligibility(true);
      if (hasActiveWelcomeVoucherDismissal()) {
        setIsOpen(false);
        setCheckingEligibility(false);
        return;
      }

      try {
        const orders = userId ? await orderService.getCustomerOrders(50) : [];
        if (cancelled) return;
        const shouldShow = !hasPaidOrderOrVoucherUse(orders);
        setIsOpen(shouldShow);
        if (shouldShow && !viewedRef.current) {
          viewedRef.current = true;
          recordWelcomeVoucherEvent('popup_viewed', { userId: userId || null });
        }
      } catch (error) {
        console.warn('Não foi possível validar elegibilidade do voucher de boas-vindas:', error);
        if (!cancelled) setIsOpen(false);
      } finally {
        if (!cancelled) setCheckingEligibility(false);
      }
    }

    checkEligibility();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const close = React.useCallback((source: 'x' | 'start_shopping' | 'backdrop') => {
    dismissWelcomeVoucher();
    recordWelcomeVoucherEvent('popup_closed', { source, userId: userId || null });
    setIsOpen(false);
  }, [userId]);

  const copyCoupon = async () => {
    await writeClipboard(WELCOME_VOUCHER_CODE);
    saveWelcomeVoucherForCheckout();
    recordWelcomeVoucherEvent('coupon_copied', { userId: userId || null });
    showToast('Cupom copiado com sucesso!', 'success');
  };

  if (checkingEligibility && !isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-140 flex items-center justify-center bg-brutal-black/70 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-voucher-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close('backdrop');
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden brutal-border bg-white brutal-shadow sm:max-h-[calc(100dvh-4rem)]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-brutal-accent" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brutal-accent/20" />
            <div className="pointer-events-none absolute left-6 top-7 flex gap-3 text-brutal-accent">
              <Sparkles className="h-4 w-4 animate-pulse" />
              <Sparkles className="mt-7 h-3 w-3 animate-pulse" />
              <Sparkles className="mt-3 h-5 w-5 animate-pulse" />
            </div>

            <button
              type="button"
              onClick={() => close('x')}
              className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center brutal-border-thin bg-white text-brutal-black transition-colors hover:bg-gray-50"
              aria-label="Fechar voucher de boas-vindas"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative min-h-0 overflow-y-auto px-4 pb-5 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center brutal-border bg-brutal-accent text-white brutal-shadow sm:mb-5 sm:h-16 sm:w-16">
                <Gift className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>

              <div className="text-center">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-gray-500 sm:text-[10px] sm:tracking-[0.28em]">Presente de primeira compra</p>
                <h2 id="welcome-voucher-title" className="mt-2 font-display text-[2.1rem] uppercase leading-none sm:text-4xl">
                  Bem-vindo a Funpace Media!
                </h2>
                <p className="mx-auto mt-3 max-w-sm font-mono text-[10px] uppercase leading-relaxed text-gray-600 sm:mt-4 sm:text-xs">
                  Como forma de boas-vindas, preparamos um presente para você.
                </p>
              </div>

              <div className="mt-5 bg-gray-50 brutal-border p-3 text-center sm:mt-6 sm:p-5">
                <p className="font-display text-[1.8rem] uppercase leading-none sm:text-2xl">Ganhe 10% OFF</p>
                <p className="mt-2 font-mono text-[8px] uppercase leading-relaxed text-gray-500 sm:text-[10px]">
                  Na sua primeira compra utilizando o cupom
                </p>
                <div className="mt-3 w-full min-w-0 overflow-hidden brutal-border bg-white px-2 py-3 font-display text-[clamp(1.45rem,8.5vw,2.2rem)] uppercase leading-none tracking-[0.03em] text-brutal-accent sm:mt-4 sm:px-4 sm:py-4 sm:text-3xl sm:tracking-[0.08em]">
                  {WELCOME_VOUCHER_CODE}
                </div>
                <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.16em] text-gray-500 sm:text-[9px] sm:tracking-widest">
                  Válido apenas para a primeira compra.
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:mt-6">
                <button
                  type="button"
                  onClick={copyCoupon}
                  className="min-h-13 w-full inline-flex items-center justify-center gap-2 brutal-border bg-brutal-accent px-4 py-3 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-brutal-black sm:min-h-14 sm:px-5 sm:text-base sm:tracking-[0.14em]"
                >
                  <Copy className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                  <span className="whitespace-nowrap leading-none">Copiar Cupom</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close('start_shopping');
                    onStartShopping();
                  }}
                  className="min-h-13 w-full inline-flex items-center justify-center brutal-border bg-white px-4 py-3 font-display text-sm uppercase tracking-widest text-brutal-black transition-colors hover:bg-gray-50 sm:min-h-14 sm:px-5 sm:text-base sm:tracking-[0.14em]"
                >
                  <span className="whitespace-nowrap leading-none">Começar a Comprar</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
