import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, ReceiptText, X, ExternalLink, Image as ImageIcon, Video, Download, Trash2 } from 'lucide-react';
import { Order } from '../types';
import { orderService } from '../lib/services';

interface CustomerOrdersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  highlightedOrderId?: string | null;
}

const statusLabels: Record<Order['status'], string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

const statusClasses: Record<Order['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
  refunded: 'bg-blue-100 text-blue-800',
};

function safeFilename(name: string) {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function filenameFromItem(item: { name: string; url: string; type: string }) {
  try {
    const u = new URL(item.url);
    const pathname = u.pathname || '';
    const last = pathname.split('/').pop() || '';
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(last);
    if (hasExt) return safeFilename(last);
  } catch {
    // ignore URL parse errors
  }

  const ext = item.type === 'IMG' ? '.jpg' : item.type === 'VIDEO' ? '.mp4' : '';
  return safeFilename(item.name || 'arquivo') + ext;
}

async function downloadFile(url: string, filename: string) {
  // Try to force a file download. If fetch/CORS fails, fall back to opening the URL.
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('download_failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function authorizeDownload(orderId: string, orderItemId: string) {
  const response = await fetch('/api/downloads/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, orderItemId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.error || 'Nao foi possivel autorizar o download.');
  }
  return String(payload.url);
}

const hiddenPurchasesStorageKey = 'funpace:hidden-purchases:v1';

function loadHiddenPurchaseIds(): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenPurchasesStorageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String));
  } catch {
    return new Set();
  }
}

function saveHiddenPurchaseIds(ids: Set<string>) {
  localStorage.setItem(hiddenPurchasesStorageKey, JSON.stringify(Array.from(ids)));
}

export function CustomerOrdersDrawer({ isOpen, onClose, highlightedOrderId }: CustomerOrdersDrawerProps) {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hiddenItemIds, setHiddenItemIds] = React.useState<Set<string>>(() => loadHiddenPurchaseIds());

  React.useEffect(() => {
    if (!isOpen) return;

    async function loadOrders() {
      setIsLoading(true);
      setError(null);

      try {
        const customerOrders = await orderService.getCustomerOrders();
        setOrders(customerOrders);
      } catch (err) {
        console.error('Erro ao carregar compras:', err);
        setError('Nao foi possivel carregar suas compras.');
      } finally {
        setIsLoading(false);
      }
    }

    loadOrders();
  }, [isOpen]);

  const hideItem = (itemId: string) => {
    const ok = window.confirm('Remover este item de "Minhas Compras" neste dispositivo?');
    if (!ok) return;
    setHiddenItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      saveHiddenPurchaseIds(next);
      return next;
    });
  };

  const downloadPaidOrder = async (order: Order) => {
    const items = (order.items ?? []).filter((item) => item.url && !hiddenItemIds.has(item.id));
    for (const item of items) {
      const signedUrl = await authorizeDownload(order.id, item.id);
      await downloadFile(signedUrl, filenameFromItem(item as any));
    }
  };

  const downloadPaidItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    const signedUrl = await authorizeDownload(order.id, item.id);
    await downloadFile(signedUrl, filenameFromItem(item as any));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brutal-black/70 backdrop-blur-sm z-[80]"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-brutal-white z-[90] brutal-border-l shadow-2xl flex flex-col"
          >
            <header className="p-6 bg-brutal-black text-white border-b-4 border-brutal-black flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ReceiptText className="w-6 h-6 text-brutal-accent" />
                <div>
                  <h2 className="font-display text-2xl uppercase tracking-tighter">Minhas Compras</h2>
                  <p className="font-mono text-[10px] text-gray-400 uppercase">Pedidos e pagamentos</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:text-brutal-accent transition-colors cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6">
              {isLoading && (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-brutal-accent mb-4" />
                  <p className="font-mono text-xs uppercase text-gray-500">Carregando compras...</p>
                </div>
              )}

              {!isLoading && error && (
                <div className="p-4 bg-red-50 brutal-border-thin text-red-700 font-mono text-xs uppercase">
                  {error}
                </div>
              )}

              {!isLoading && !error && orders.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <ReceiptText className="w-14 h-14 text-gray-300 mb-4" />
                  <h3 className="font-display text-2xl uppercase mb-2">Nenhuma compra</h3>
                  <p className="font-mono text-xs text-gray-500 uppercase leading-relaxed">
                    Suas compras aparecerao aqui depois que um pedido for criado.
                  </p>
                </div>
              )}

              {!isLoading && !error && orders.length > 0 && (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <article
                      key={order.id}
                      className={`bg-white brutal-border p-4 space-y-4 ${
                        highlightedOrderId === order.id ? 'ring-4 ring-brutal-accent' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-lg uppercase truncate">Pedido #{order.id.slice(0, 8)}</p>
                          <p className="font-mono text-[10px] text-gray-400 uppercase">
                            {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        <span className={`px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase ${statusClasses[order.status]}`}>
                          {statusLabels[order.status]}
                        </span>
                      </div>

                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="font-mono text-[10px] text-gray-400 uppercase">Total</p>
                          <p className="font-display text-3xl">R$ {Number(order.total).toFixed(2)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {order.status === 'pending' && order.checkoutUrl && (
                            <a
                              href={order.checkoutUrl}
                              className="inline-flex items-center gap-2 bg-brutal-black text-white px-3 py-2 brutal-border-thin font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors"
                            >
                              Pagar
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {order.status === 'paid' && (order.items?.length ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => downloadPaidOrder(order)}
                              className="inline-flex items-center gap-2 bg-brutal-black text-white px-3 py-2 brutal-border-thin font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer"
                            >
                              Baixar tudo
                              <Download className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="border-t-2 border-gray-100 pt-4 space-y-3">
                        <p className="font-mono text-[10px] text-gray-400 uppercase">
                          {order.items?.length ?? 0} itens comprados
                        </p>
                        {(order.items ?? [])
                          .filter((item) => !hiddenItemIds.has(item.id))
                          .map((item) => (
                          <div key={item.id} className="flex items-center gap-3 bg-gray-50 brutal-border-thin p-2">
                            <div className="w-12 h-12 bg-brutal-black text-white brutal-border-thin overflow-hidden flex items-center justify-center">
                              {item.thumbnailUrl || item.type === 'IMG' ? (
                                <img src={item.thumbnailUrl || item.url} alt={item.name} className="w-full h-full object-cover" />
                              ) : (
                                <Video className="w-5 h-5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-display text-sm uppercase truncate">{item.name}</p>
                              <p className="font-mono text-[9px] text-gray-400 uppercase truncate">
                                {item.type} - Peito {item.bib || 'N/I'} - {item.event}
                              </p>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                              <p className="font-display text-sm">R$ {Number(item.price).toFixed(2)}</p>
                              {item.type === 'IMG' ? <ImageIcon className="w-3 h-3 ml-auto text-gray-400" /> : <Video className="w-3 h-3 ml-auto text-gray-400" />}
                              {order.status === 'paid' && item.url && (
                                <button
                                  type="button"
                                  onClick={() => downloadPaidItem(order, item)}
                                  className="inline-flex items-center gap-2 bg-brutal-black text-white px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer"
                                  title="Baixar arquivo"
                                >
                                  Baixar
                                  <Download className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => hideItem(item.id)}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                                title="Remover da lista (nao apaga do sistema)"
                              >
                                Remover
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
