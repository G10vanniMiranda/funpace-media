import { CheckCircle2, ReceiptText, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export type PaymentNotice = {
  status: 'paid' | 'pending' | 'cancelled' | 'canceled';
  orderId?: string | null;
  message: string;
};

interface PaymentNoticeModalProps {
  notice: PaymentNotice;
  onClose: () => void;
  onOpenOrders: () => void;
}

export function PaymentNoticeModal({ notice, onClose, onOpenOrders }: PaymentNoticeModalProps) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-120 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-brutal-black/80 backdrop-blur-sm"
        />
        <motion.div
          initial={{ scale: 0.92, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.92, y: 20 }}
          className="relative w-full max-w-xl overflow-hidden bg-white brutal-border brutal-shadow-heavy p-5 sm:p-8"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-2 text-gray-400 hover:text-brutal-black transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <div className={`p-4 brutal-border ${notice.status === 'paid' ? 'bg-green-50 text-green-600' :
              notice.status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
                'bg-red-50 text-red-600'
              }`}>
              {notice.status === 'paid' ? <CheckCircle2 className="w-8 h-8" /> : <XCircle className="w-8 h-8" />}
            </div>

            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2 wrap-break-word">
                Retorno da InfinitePay
              </p>
              <h2 className="max-w-full font-display text-[clamp(1.65rem,8vw,2.4rem)] uppercase tracking-normal leading-[1.02] wrap-break-word">
                {notice.status === 'paid' ? 'Pagamento confirmado' : notice.status === 'pending' ? 'Confirmacao pendente' : 'Pagamento cancelado'}
              </h2>
              <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-3">
                {notice.message}
              </p>
              {notice.orderId && (
                <p className="font-mono text-[10px] uppercase text-gray-400 mt-4">
                  Pedido #{notice.orderId.slice(0, 8)}
                </p>
              )}

              <div className="flex w-full flex-col gap-3 mt-8 sm:flex-row">
                <button
                  onClick={onOpenOrders}
                  className="min-h-12 w-full px-5 py-3 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2 sm:w-auto"
                >
                  <ReceiptText className="w-4 h-4" />
                  Abrir minha conta
                </button>
                <button
                  onClick={onClose}
                  className="min-h-12 w-full px-5 py-3 bg-white text-brutal-black brutal-border font-display text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors cursor-pointer sm:w-auto"
                >
                  Continuar na loja
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
