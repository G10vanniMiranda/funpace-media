import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, ReceiptText, XCircle } from 'lucide-react';
import { buildCustomerOrdersPath } from '../../lib/customer-flow';

type PaymentStatus = 'checking' | 'paid' | 'pending' | 'error';

function getParam(params: URLSearchParams, names: string[]) {
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }

  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of params.entries()) {
    if (lowerNames.has(key.toLowerCase()) && value) return value;
  }

  return null;
}

function normalizePaymentText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ã|Ã£/g, 'a');
}

function isPendingConfirmation(responseStatus: number, payload: any) {
  const text = normalizePaymentText(payload?.error || payload?.message || '');

  return payload?.paid === false ||
    [400, 404, 409, 500, 502, 503, 504].includes(responseStatus) ||
    text.includes('ainda nao confirmado') ||
    (text.includes('ainda') && text.includes('confirmad')) ||
    text.includes('nao identificamos o pedido') ||
    (text.includes('identificamos') && text.includes('pedido'));
}

function getDisplayStatus(status: PaymentStatus, message: string): PaymentStatus {
  const text = normalizePaymentText(message);

  if (
    status === 'error' &&
    (
      text.includes('ainda nao confirmado') ||
      (text.includes('ainda') && text.includes('confirmad')) ||
      text.includes('nao foi possivel confirmar')
    )
  ) {
    return 'pending';
  }

  return status;
}

function getTitleLines(status: PaymentStatus) {
  if (status === 'checking') return ['Confirmando'];
  if (status === 'paid') return ['Pagamento', 'confirmado'];
  if (status === 'pending') return ['Confirmacao', 'pendente'];
  return ['Falha na', 'confirmacao'];
}

export function PagamentoSucesso() {
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<PaymentStatus>('checking');
  const [message, setMessage] = React.useState('Confirmando pagamento com a InfinitePay.');
  const [orderId, setOrderId] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function confirmPayment() {
      const params = new URLSearchParams(window.location.search);
      const order = getParam(params, ['order', 'order_nsu', 'orderNsu', 'orderNSU', 'order_id', 'orderId']);
      const transactionNsu = getParam(params, ['transaction_nsu', 'transactionNSU', 'transaction_id', 'transactionId', 'nsu']);
      const slug = getParam(params, ['slug', 'invoice_slug', 'invoiceSlug', 'invoice_id', 'invoiceId']);
      const captureMethod = getParam(params, ['capture_method', 'captureMethod', 'payment_method', 'paymentMethod']);

      setOrderId(order);

      if (!order) {
        setStatus('pending');
        setMessage('Recebemos o retorno do checkout, mas não identificamos o pedido. A liberação acontecerá quando a InfinitePay confirmar o pagamento.');
        return;
      }

      try {
        const response = await fetch('/api/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order,
            order_nsu: params.get('order_nsu'),
            transaction_nsu: transactionNsu,
            transaction_id: params.get('transaction_id'),
            slug,
            invoice_slug: params.get('invoice_slug'),
            capture_method: captureMethod,
            payment: params.get('payment'),
            return_source: 'pagamento_sucesso',
            raw_query: Object.fromEntries(params.entries()),
          }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus(isPendingConfirmation(response.status, payload) ? 'pending' : 'error');
          setMessage(payload?.error || payload?.message || 'Pagamento ainda não confirmado.');
          return;
        }

        setStatus('paid');
        setMessage('Pagamento confirmado. Seus arquivos digitais já estão liberados na sua conta.');
        navigate(buildCustomerOrdersPath(order, 'paid'), { replace: true });
      } catch (error) {
        console.error('Erro ao confirmar pagamento:', error);
        setStatus('pending');
        setMessage('Pagamento ainda não confirmado. A liberação acontecerá quando a InfinitePay confirmar.');
      }
    }

    confirmPayment();
  }, []);

  const displayStatus = getDisplayStatus(status, message);
  const titleLines = getTitleLines(displayStatus);
  const isPaid = displayStatus === 'paid';
  const isChecking = displayStatus === 'checking';

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-brutal-white text-brutal-black flex items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <section className="w-full max-w-[min(42rem,calc(100vw-2rem))] overflow-hidden bg-white brutal-border brutal-shadow-heavy p-4 sm:p-8 md:p-10">
        <div className="flex flex-col items-start gap-5 sm:flex-row">
          <div className={`shrink-0 p-3 sm:p-4 brutal-border ${
            isPaid ? 'bg-green-50 text-green-600' :
            isChecking ? 'bg-gray-50 text-brutal-black' :
            displayStatus === 'pending' ? 'bg-yellow-50 text-yellow-700' :
            'bg-red-50 text-red-600'
          }`}>
            {isChecking ? (
              <Loader2 className="w-8 h-8 sm:w-9 sm:h-9 animate-spin" />
            ) : isPaid ? (
              <CheckCircle2 className="w-8 h-8 sm:w-9 sm:h-9" />
            ) : (
              <XCircle className="w-8 h-8 sm:w-9 sm:h-9" />
            )}
          </div>

          <div className="min-w-0 w-full flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2 break-words">
              Retorno da InfinitePay
            </p>
            <h1 className="max-w-full font-display text-[clamp(1.85rem,9vw,3.5rem)] uppercase tracking-normal leading-[0.95] [overflow-wrap:anywhere]">
              {titleLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-4">
              {message}
            </p>
            {orderId && (
              <p className="font-mono text-[10px] uppercase text-gray-400 mt-5">
                Pedido #{orderId.slice(0, 8)}
              </p>
            )}

            <div className="flex w-full flex-col gap-3 mt-8 sm:flex-row">
              <button
                onClick={() => navigate(buildCustomerOrdersPath(orderId, isPaid ? 'paid' : displayStatus === 'pending' ? 'pending' : null))}
                className="min-h-12 w-full px-4 py-3 bg-brutal-black text-white brutal-border font-display text-xs sm:text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2 sm:w-auto"
              >
                <ReceiptText className="w-4 h-4 shrink-0" />
                Minha conta
              </button>
              <button
                onClick={() => navigate('/')}
                className="min-h-12 w-full px-4 py-3 bg-white text-brutal-black brutal-border font-display text-xs sm:text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 sm:w-auto"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                Voltar para loja
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
