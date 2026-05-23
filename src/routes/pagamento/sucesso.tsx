import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, ReceiptText, XCircle } from 'lucide-react';

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
        setMessage('Recebemos o retorno do checkout, mas nao identificamos o pedido. A liberacao acontecera quando a InfinitePay confirmar o pagamento.');
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
            raw_query: Object.fromEntries(params.entries()),
          }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus([400, 409, 502].includes(response.status) ? 'pending' : 'error');
          setMessage(payload?.error || payload?.message || 'Pagamento ainda nao confirmado.');
          return;
        }

        setStatus('paid');
        setMessage('Pagamento confirmado. Seus arquivos digitais ja estao liberados para download em Minhas Compras.');
      } catch (error: any) {
        console.error('Erro ao confirmar pagamento:', error);
        setStatus('error');
        setMessage(error?.message || 'Nao foi possivel confirmar o pagamento agora.');
      }
    }

    confirmPayment();
  }, []);

  const isPaid = status === 'paid';
  const isChecking = status === 'checking';

  return (
    <main className="min-h-screen bg-brutal-white text-brutal-black flex items-center justify-center px-6 py-10">
      <section className="w-full max-w-2xl bg-white brutal-border brutal-shadow-heavy p-8 md:p-10">
        <div className="flex items-start gap-5">
          <div className={`p-4 brutal-border ${
            isPaid ? 'bg-green-50 text-green-600' :
            isChecking ? 'bg-gray-50 text-brutal-black' :
            status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
            'bg-red-50 text-red-600'
          }`}>
            {isChecking ? (
              <Loader2 className="w-9 h-9 animate-spin" />
            ) : isPaid ? (
              <CheckCircle2 className="w-9 h-9" />
            ) : (
              <XCircle className="w-9 h-9" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2">
              Retorno da InfinitePay
            </p>
            <h1 className="font-display text-5xl uppercase tracking-tighter">
              {isChecking ? 'Confirmando' : isPaid ? 'Pagamento confirmado' : status === 'pending' ? 'Confirmacao pendente' : 'Falha na confirmacao'}
            </h1>
            <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-4">
              {message}
            </p>
            {orderId && (
              <p className="font-mono text-[10px] uppercase text-gray-400 mt-5">
                Pedido #{orderId.slice(0, 8)}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <button
                onClick={() => navigate('/')}
                className="h-12 px-5 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <ReceiptText className="w-4 h-4" />
                Ir para loja
              </button>
              <button
                onClick={() => navigate('/checkout')}
                className="h-12 px-5 bg-white text-brutal-black brutal-border font-display text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao checkout
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
