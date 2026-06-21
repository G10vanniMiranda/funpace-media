import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, ReceiptText, X, ExternalLink, Image as ImageIcon, Video, Download, Trash2, Share2, Copy, Heart, Plus, CalendarDays, CheckCircle2, Clock3, CreditCard, RefreshCw, Search, ShieldCheck, UserCircle } from 'lucide-react';
import { Order, Product } from '../types';
import { orderService } from '../lib/services';
import { getCurrentAccessToken, getCurrentUser } from '../lib/supabase';
import { copyText, createProductShareUrl } from '../lib/customer-engagement';
import { buildSafeDownloadPath, shouldUseSafeDownloadPage } from '../lib/download-flow';
import { ProtectedMedia } from './ProtectedMedia';

interface CustomerOrdersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  highlightedOrderId?: string | null;
  favoriteProducts?: Product[];
  onAddToCart?: (product: Product) => void;
  onToggleFavorite?: (product: Product) => void;
}

const statusLabels: Record<Order['status'], string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  refused: 'Recusado',
  refunded: 'Reembolsado',
};

const statusClasses: Record<Order['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
  canceled: 'bg-gray-100 text-gray-700',
  refused: 'bg-red-100 text-red-800',
  refunded: 'bg-blue-100 text-blue-800',
};

const statusPanelClasses: Record<Order['status'], string> = {
  pending: 'border-yellow-300 bg-yellow-50 text-yellow-800',
  paid: 'border-green-300 bg-green-50 text-green-800',
  failed: 'border-red-300 bg-red-50 text-red-800',
  cancelled: 'border-gray-300 bg-gray-50 text-gray-700',
  canceled: 'border-gray-300 bg-gray-50 text-gray-700',
  refused: 'border-red-300 bg-red-50 text-red-800',
  refunded: 'border-blue-300 bg-blue-50 text-blue-800',
};

type CustomerPanelFilter = 'all' | 'paid' | 'pending' | 'favorites';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatShortDate(value?: string) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function orderMatchesQuery(order: Order, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const orderFields = [
    order.id,
    order.buyerName,
    order.buyerEmail,
    order.status,
    ...(order.items ?? []).flatMap((item) => [
      item.name,
      item.event,
      item.checkpoint,
      item.bib,
      item.productId,
    ]),
  ];

  return orderFields.some((value) => String(value || '').toLowerCase().includes(normalized));
}

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

type AuthorizedDownload = {
  downloadUrl: string;
  inlineUrl: string;
  saveUrl: string;
  filename: string;
};

async function authorizeDownload(orderId: string, orderItemId: string): Promise<AuthorizedDownload> {
  const accessToken = await getCurrentAccessToken();
  const response = await fetch('/api/downloads/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ orderId, orderItemId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.error || payload?.message || `Não foi possível autorizar o download. HTTP ${response.status}`);
  }
  return {
    downloadUrl: String(payload.downloadUrl || payload.url),
    inlineUrl: String(payload.inlineUrl || payload.url),
    saveUrl: String(payload.saveUrl || payload.inlineUrl || payload.url),
    filename: String(payload.filename || 'funpace-media'),
  };
}

function triggerBrowserDownload(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

function productFromOrderItem(item: NonNullable<Order['items']>[number]): Product {
  return {
    id: item.productId,
    name: item.name,
    price: Number(item.price || 0),
    url: item.url,
    type: item.type,
    vendedorId: item.vendedorId,
    bib: item.bib,
    event: item.event,
    checkpoint: item.checkpoint,
    thumbnailUrl: item.thumbnailUrl ?? undefined,
    createdAt: item.createdAt,
  };
}

function buildReceiptText(order: Order) {
  return [
    'Recibo Funpace Media',
    `Pedido: ${order.id}`,
    `Status: ${statusLabels[order.status]}`,
    `Comprador: ${order.buyerName} <${order.buyerEmail}>`,
    `Total: R$ ${Number(order.total).toFixed(2)}`,
    `Data: ${new Date(order.createdAt).toLocaleString('pt-BR')}`,
    `Itens: ${(order.items ?? []).map((item) => item.name).join(', ') || 'Sem itens'}`,
  ].join('\n');
}

export function CustomerOrdersDrawer({
  isOpen,
  onClose,
  highlightedOrderId,
  favoriteProducts = [],
  onAddToCart,
  onToggleFavorite,
}: CustomerOrdersDrawerProps) {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hiddenItemIds, setHiddenItemIds] = React.useState<Set<string>>(() => loadHiddenPurchaseIds());
  const [copiedMessage, setCopiedMessage] = React.useState<string | null>(null);
  const [resendingEmailOrderId, setResendingEmailOrderId] = React.useState<string | null>(null);

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
        setError('Não foi possível carregar suas compras.');
      } finally {
        setIsLoading(false);
      }
    }

    loadOrders();
  }, [isOpen]);

  const hideItem = (itemId: string) => {
    const ok = window.confirm('Remover este item da sua conta neste dispositivo?');
    if (!ok) return;
    setHiddenItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      saveHiddenPurchaseIds(next);
      return next;
    });
  };

  const downloadPaidOrder = async (order: Order) => {
    try {
      const items = (order.items ?? []).filter((item) => !hiddenItemIds.has(item.id));
      if (shouldUseSafeDownloadPage() && items[0]) {
        window.location.assign(buildSafeDownloadPath(order.id, items[0].id));
        return;
      }
      for (const item of items) {
        const authorized = await authorizeDownload(order.id, item.id);
        triggerBrowserDownload(authorized.downloadUrl);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      console.error('Erro ao baixar pedido:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível baixar o pedido.');
    }
  };

  const downloadPaidItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    try {
      if (shouldUseSafeDownloadPage()) {
        window.location.assign(buildSafeDownloadPath(order.id, item.id));
        return;
      }
      const authorized = await authorizeDownload(order.id, item.id);
      triggerBrowserDownload(authorized.downloadUrl);
    } catch (error) {
      console.error('Erro ao baixar arquivo:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível baixar o arquivo.');
    }
  };

  const openPaidItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    window.location.assign(buildSafeDownloadPath(order.id, item.id));
  };

  const showCopied = (message: string) => {
    setCopiedMessage(message);
    window.setTimeout(() => setCopiedMessage((current) => current === message ? null : current), 1800);
  };

  const copyReceipt = async (order: Order) => {
    await copyText(buildReceiptText(order));
    showCopied('Recibo copiado');
  };

  const resendDownloadEmail = async (order: Order) => {
    setResendingEmailOrderId(order.id);
    try {
      await orderService.resendDownloadEmail(order.id, 'customer');
      showCopied('Links enviados por e-mail');
    } catch (error) {
      console.error('Erro ao reenviar e-mail de download:', error);
      alert(error instanceof Error ? error.message : 'Nao foi possivel reenviar o e-mail.');
    } finally {
      setResendingEmailOrderId(null);
    }
  };

  const shareItem = async (item: NonNullable<Order['items']>[number]) => {
    const url = createProductShareUrl(item.productId);
    if (navigator.share) {
      try {
        await navigator.share({ title: item.name, text: [item.event, item.bib ? `peito ${item.bib}` : ''].filter(Boolean).join(' - '), url });
        return;
      } catch {
        // Fallback to clipboard.
      }
    }

    await copyText(url);
    showCopied('Link copiado');
  };

  const visibleOrders = orders
    .map((order) => ({
      ...order,
      items: (order.items ?? []).filter((item) => !hiddenItemIds.has(item.id)),
    }))
    .filter((order) => (order.items?.length ?? 0) > 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brutal-black/70 backdrop-blur-sm z-80"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-brutal-white z-90 brutal-border-l shadow-2xl flex flex-col"
          >
            <header className="p-6 bg-brutal-black text-white border-b-4 border-brutal-black flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ReceiptText className="w-6 h-6 text-brutal-accent" />
                <div>
                  <h2 className="font-display text-2xl uppercase tracking-tighter">Minha Conta</h2>
                  <p className="font-mono text-[10px] text-gray-400 uppercase">Pedidos e pagamentos</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:text-brutal-accent transition-colors cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6">
              {copiedMessage && (
                <div className="mb-4 p-3 bg-green-50 brutal-border-thin text-green-700 font-mono text-[10px] uppercase">
                  {copiedMessage}
                </div>
              )}

              {!isLoading && !error && favoriteProducts.length > 0 && (
                <section className="mb-6 bg-white brutal-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-brutal-accent fill-current" />
                    <h3 className="font-display text-xl uppercase">Favoritos</h3>
                  </div>
                  <div className="space-y-2">
                    {favoriteProducts.slice(0, 6).map((item) => (
                      <div key={item.id} className="flex items-center gap-3 bg-gray-50 brutal-border-thin p-2">
                        <div className="w-11 h-11 bg-brutal-black text-white brutal-border-thin overflow-hidden flex items-center justify-center">
                          <ProtectedMedia
                            src={item.thumbnailUrl || null}
                            alt={item.name}
                            type={item.type}
                            watermark={`FUNPACE ${item.bib || item.id.slice(0, 6)}`}
                            mediaId={item.id}
                            eventName={item.event}
                            imgClassName="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-sm uppercase truncate">{item.name}</p>
                          <p className="font-mono text-[9px] text-gray-400 uppercase truncate">{[item.bib ? `Peito ${item.bib}` : '', `R$ ${Number(item.price).toFixed(2)}`].filter(Boolean).join(' - ')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAddToCart?.(item)}
                          className="h-8 w-8 bg-brutal-black text-white brutal-border-thin inline-flex items-center justify-center hover:bg-brutal-accent transition-colors cursor-pointer"
                          title="Adicionar ao carrinho"
                          aria-label="Adicionar favorito ao carrinho"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleFavorite?.(item)}
                          className="h-8 w-8 bg-white text-brutal-black brutal-border-thin inline-flex items-center justify-center hover:text-red-600 transition-colors cursor-pointer"
                          title="Remover dos favoritos"
                          aria-label="Remover favorito"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

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

              {!isLoading && !error && visibleOrders.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <ReceiptText className="w-14 h-14 text-gray-300 mb-4" />
                  <h3 className="font-display text-2xl uppercase mb-2">Nenhuma compra</h3>
                  <p className="font-mono text-xs text-gray-500 uppercase leading-relaxed">
                    Suas compras aparecerão aqui depois que um pedido for criado.
                  </p>
                </div>
              )}

              {!isLoading && !error && visibleOrders.length > 0 && (
                <div className="space-y-4">
                  {visibleOrders.map((order) => (
                    <article
                      key={order.id}
                      className={`bg-white brutal-border p-4 space-y-4 ${highlightedOrderId === order.id ? 'ring-4 ring-brutal-accent' : ''
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
                            <>
                              <button
                                type="button"
                                onClick={() => copyReceipt(order)}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-3 py-2 brutal-border-thin font-mono text-[10px] uppercase hover:bg-gray-50 transition-colors cursor-pointer"
                              >
                                Recibo
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadPaidOrder(order)}
                                className="inline-flex items-center gap-2 bg-brutal-black text-white px-3 py-2 brutal-border-thin font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer"
                              >
                                Baixar tudo
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={resendingEmailOrderId === order.id}
                                onClick={() => resendDownloadEmail(order)}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-3 py-2 brutal-border-thin font-mono text-[10px] uppercase hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {resendingEmailOrderId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                Reenviar links
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="border-t-2 border-gray-100 pt-4 space-y-3">
                        <p className="font-mono text-[10px] text-gray-400 uppercase">
                          {order.items?.length ?? 0} itens comprados
                        </p>
                        {(order.items ?? []).map((item) => (
                          <div key={item.id} className="flex items-center gap-3 bg-gray-50 brutal-border-thin p-2">
                            <div className="w-12 h-12 bg-brutal-black text-white brutal-border-thin overflow-hidden flex items-center justify-center">
                              <ProtectedMedia
                                src={item.thumbnailUrl || null}
                                alt={item.name}
                                type={item.type}
                                watermark={`FUNPACE ${order.id.slice(0, 8)}`}
                                mediaId={item.productId || item.id}
                                eventName={item.event}
                                imgClassName="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-display text-sm uppercase truncate">{item.name}</p>
                              <p className="font-mono text-[9px] text-gray-400 uppercase truncate">
                                {[item.type, item.bib ? `Peito ${item.bib}` : '', item.event].filter(Boolean).join(' - ')}
                              </p>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                              <p className="font-display text-sm">R$ {Number(item.price).toFixed(2)}</p>
                              {item.type === 'IMG' ? <ImageIcon className="w-3 h-3 ml-auto text-gray-400" /> : <Video className="w-3 h-3 ml-auto text-gray-400" />}
                              {order.status === 'paid' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openPaidItem(order, item)}
                                    className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer"
                                    title="Abrir arquivo"
                                  >
                                    Abrir
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadPaidItem(order, item)}
                                    className="inline-flex items-center gap-2 bg-brutal-black text-white px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer"
                                    title="Baixar arquivo"
                                  >
                                    Baixar
                                    <Download className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => shareItem(item)}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer"
                                title="Copiar link compartilhavel"
                              >
                                Link
                                <Share2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onToggleFavorite?.(productFromOrderItem(item))}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer"
                                title="Favoritar imagem"
                              >
                                Favoritar
                                <Heart className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => hideItem(item.id)}
                                className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 brutal-border-thin font-mono text-[9px] uppercase hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                                title="Remover da lista (não apaga do sistema)"
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

interface CustomerOrdersPageProps {
  highlightedOrderId?: string | null;
  paymentStatus?: 'paid' | 'pending' | 'cancelled' | 'canceled' | null;
  favoriteProducts?: Product[];
  isAuthenticated: boolean;
  onLoginRequested: () => void;
  onAddToCart?: (product: Product) => void;
  onToggleFavorite?: (product: Product) => void;
}

function CustomerMetricCard({
  label,
  value,
  icon,
  tone = 'light',
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className={`border p-4 shadow-sm ${tone === 'dark' ? 'border-brutal-black bg-brutal-black text-white' : 'border-slate-200 bg-white text-brutal-black'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${tone === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
          {label}
        </p>
        <div className={`h-10 w-10 border flex items-center justify-center ${tone === 'dark' ? 'border-white/15 bg-white/10 text-brutal-accent' : 'border-slate-200 bg-slate-50 text-brutal-accent'}`}>
          {icon}
        </div>
      </div>
      <p className="mt-4 font-display text-[clamp(1.65rem,4vw,2.35rem)] uppercase leading-none tracking-normal wrap-break-word">
        {value}
      </p>
    </div>
  );
}

function FavoritePanelItem({
  product,
  onAddToCart,
  onToggleFavorite,
}: {
  product: Product;
  onAddToCart?: (product: Product) => void;
  onToggleFavorite?: (product: Product) => void;
}) {
  return (
    <article className="bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="aspect-4/3 bg-brutal-black text-white flex items-center justify-center overflow-hidden">
        <ProtectedMedia
          src={product.thumbnailUrl || null}
          alt={product.name}
          type={product.type}
          watermark={`FUNPACE ${product.bib || product.id.slice(0, 6)}`}
          mediaId={product.id}
          eventName={product.event}
          imgClassName="h-full w-full object-cover"
        />
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg uppercase truncate">{product.name}</p>
            <p className="font-mono text-[10px] uppercase text-slate-400 truncate">
              {[product.bib ? `Peito ${product.bib}` : '', product.event || 'Evento'].filter(Boolean).join(' - ')}
            </p>
          </div>
          <p className="font-display text-lg shrink-0">{formatCurrency(Number(product.price))}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onAddToCart?.(product)}
            className="min-h-10 bg-brutal-black text-white border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            <Plus className="w-3 h-3" />
            Carrinho
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite?.(product)}
            className="min-h-10 bg-white text-brutal-black border border-slate-200 font-mono text-[10px] uppercase hover:border-red-300 hover:text-red-600 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            <X className="w-3 h-3" />
            Remover
          </button>
        </div>
      </div>
    </article>
  );
}

export function CustomerOrdersPage({
  highlightedOrderId,
  paymentStatus,
  favoriteProducts = [],
  isAuthenticated,
  onLoginRequested,
  onAddToCart,
  onToggleFavorite,
}: CustomerOrdersPageProps) {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<CustomerPanelFilter>('all');
  const [query, setQuery] = React.useState('');
  const currentUser = getCurrentUser();

  const loadOrders = React.useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);

    try {
      const customerOrders = await orderService.getCustomerOrders();
      setOrders(customerOrders);
    } catch (err) {
      console.error('Erro ao carregar compras:', err);
      setError('Não foi possível carregar suas compras.');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  React.useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const showCopied = (message: string) => {
    setCopiedMessage(message);
    window.setTimeout(() => setCopiedMessage((current) => current === message ? null : current), 1800);
  };

  const copyReceipt = async (order: Order) => {
    await copyText(buildReceiptText(order));
    showCopied('Recibo copiado');
  };

  const shareItem = async (item: NonNullable<Order['items']>[number]) => {
    const url = createProductShareUrl(item.productId);
    if (navigator.share) {
      try {
        await navigator.share({ title: item.name, text: [item.event, item.bib ? `peito ${item.bib}` : ''].filter(Boolean).join(' - '), url });
        return;
      } catch {
        // Fallback to clipboard.
      }
    }

    await copyText(url);
    showCopied('Link copiado');
  };

  const downloadPaidItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    try {
      if (shouldUseSafeDownloadPage()) {
        window.location.assign(buildSafeDownloadPath(order.id, item.id));
        return;
      }
      const authorized = await authorizeDownload(order.id, item.id);
      triggerBrowserDownload(authorized.downloadUrl);
    } catch (error) {
      console.error('Erro ao baixar arquivo:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível baixar o arquivo.');
    }
  };

  const openPaidItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    window.location.assign(buildSafeDownloadPath(order.id, item.id));
  };

  const downloadPaidOrder = async (order: Order) => {
    try {
      if (shouldUseSafeDownloadPage() && order.items?.[0]) {
        window.location.assign(buildSafeDownloadPath(order.id, order.items[0].id));
        return;
      }
      for (const item of order.items ?? []) {
        const authorized = await authorizeDownload(order.id, item.id);
        triggerBrowserDownload(authorized.downloadUrl);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      console.error('Erro ao baixar pedido:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível baixar o pedido.');
    }
  };

  const highlightedOrder = highlightedOrderId
    ? orders.find((order) => order.id === highlightedOrderId)
    : null;
  const sortedOrders = highlightedOrder
    ? [highlightedOrder, ...orders.filter((order) => order.id !== highlightedOrder.id)]
    : orders;
  const paidOrders = sortedOrders.filter((order) => order.status === 'paid');
  const pendingOrders = sortedOrders.filter((order) => order.status === 'pending');
  const paidItems = paidOrders.flatMap((order) => (order.items ?? []).map((item) => ({ order, item })));
  const totalSpent = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const latestOrderDate = sortedOrders[0]?.createdAt;
  const customerName = currentUser?.displayName || sortedOrders[0]?.buyerName || 'Cliente Funpace';
  const customerEmail = currentUser?.email || sortedOrders[0]?.buyerEmail || 'Conta conectada';
  const filteredOrders = sortedOrders
    .filter((order) => activeFilter === 'all' || activeFilter === 'favorites' || order.status === activeFilter)
    .filter((order) => orderMatchesQuery(order, query));
  const visibleFavorites = favoriteProducts.filter((item) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized || activeFilter !== 'favorites') return true;
    return [item.name, item.event, item.checkpoint, item.bib, item.id]
      .some((value) => String(value || '').toLowerCase().includes(normalized));
  });
  const showFavoritesOnly = activeFilter === 'favorites';

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-brutal-black">
      <section className="border-b border-slate-200 bg-[#0b111a] text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">Painel do cliente</p>
              <h1 className="font-display text-[clamp(2.4rem,7vw,4.75rem)] uppercase leading-[0.9] tracking-normal">Minha area</h1>
              <p className="mt-4 max-w-2xl font-mono text-xs uppercase leading-relaxed text-slate-400">
                Compras, downloads autorizados, recibos e mídias salvas em um só lugar.
              </p>
            </div>

            <div className="w-full lg:w-90 border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 border border-white/15 bg-brutal-accent text-white flex items-center justify-center">
                  <UserCircle className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-xl uppercase truncate">{customerName}</p>
                  <p className="font-mono text-[10px] uppercase text-slate-400 truncate">{customerEmail}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="border border-white/10 bg-black/15 p-3">
                  <p className="font-mono text-[9px] uppercase text-slate-500">Status</p>
                  <p className="font-display text-lg uppercase text-green-300">{isAuthenticated ? 'Conectado' : 'Entrar'}</p>
                </div>
                <div className="border border-white/10 bg-black/15 p-3">
                  <p className="font-mono text-[9px] uppercase text-slate-500">Ultima compra</p>
                  <p className="font-display text-lg uppercase">{latestOrderDate ? formatShortDate(latestOrderDate) : 'Nenhuma'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        {paymentStatus && (
          <div className={`border p-5 ${paymentStatus === 'paid' ? 'border-green-300 bg-green-50 text-green-800' :
            paymentStatus === 'pending' ? 'bg-yellow-50 text-yellow-800' :
              'bg-red-50 text-red-700'
            }`}>
            <p className="font-display text-2xl uppercase">
              {paymentStatus === 'paid' ? 'Pagamento confirmado' : paymentStatus === 'pending' ? 'Confirmação pendente' : 'Pagamento cancelado'}
            </p>
            <p className="mt-2 font-mono text-xs uppercase leading-relaxed">
              {paymentStatus === 'paid'
                ? 'Seu pedido está liberado. Baixe os arquivos ou copie o recibo abaixo.'
                : paymentStatus === 'pending'
                  ? 'Estamos aguardando a confirmação da operadora. Você pode atualizar o status em alguns instantes.'
                  : 'O pedido continua disponível para uma nova tentativa de pagamento.'}
            </p>
            {highlightedOrderId && (
              <p className="mt-3 font-mono text-[10px] uppercase text-gray-500">Pedido #{highlightedOrderId.slice(0, 8)}</p>
            )}
          </div>
        )}

        {copiedMessage && (
          <div className="p-3 bg-green-50 brutal-border-thin text-green-700 font-mono text-[10px] uppercase">
            {copiedMessage}
          </div>
        )}

        {!isAuthenticated && (
          <div className="bg-white border border-slate-200 shadow-sm p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl uppercase">Entre para ver suas compras</h2>
              <p className="mt-1 font-mono text-xs uppercase text-gray-500">Use a mesma conta usada no checkout para liberar seus pedidos.</p>
            </div>
            <button
              type="button"
              onClick={onLoginRequested}
              className="min-h-12 px-6 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer"
            >
              Entrar
            </button>
          </div>
        )}

        {isAuthenticated && (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <CustomerMetricCard label="Total investido" value={formatCurrency(totalSpent)} icon={<CreditCard className="w-5 h-5" />} tone="dark" />
              <CustomerMetricCard label="Arquivos liberados" value={String(paidItems.length)} icon={<Download className="w-5 h-5" />} />
              <CustomerMetricCard label="Pedidos pagos" value={String(paidOrders.length)} icon={<CheckCircle2 className="w-5 h-5" />} />
              <CustomerMetricCard label="Aguardando pagamento" value={String(pendingOrders.length)} icon={<Clock3 className="w-5 h-5" />} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 shadow-sm">
                  <div className="border-b border-slate-200 p-4">
                    <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-center">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="BUSCAR POR PEDIDO, EVENTO, PEITO OU ARQUIVO"
                          className="h-12 w-full border border-slate-200 bg-slate-50 pl-10 pr-4 font-mono text-xs uppercase outline-none focus:border-brutal-accent focus:bg-white"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: 'all', label: 'Todos', count: sortedOrders.length },
                          { key: 'paid', label: 'Pagos', count: paidOrders.length },
                          { key: 'pending', label: 'Pendentes', count: pendingOrders.length },
                          { key: 'favorites', label: 'Favoritos', count: favoriteProducts.length },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveFilter(tab.key as CustomerPanelFilter)}
                            className={`min-h-10 px-3 border font-mono text-[10px] uppercase transition-colors cursor-pointer ${activeFilter === tab.key
                              ? 'border-brutal-black bg-brutal-black text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-brutal-accent hover:text-brutal-accent'
                              }`}
                          >
                            {tab.label} {tab.count}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {isLoading && (
                  <div className="bg-white border border-slate-200 p-10 text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-brutal-accent mx-auto mb-4" />
                    <p className="font-mono text-xs uppercase text-gray-500">Carregando compras...</p>
                  </div>
                )}

                {!isLoading && error && (
                  <div className="p-4 bg-red-50 brutal-border-thin text-red-700 font-mono text-xs uppercase">
                    {error}
                  </div>
                )}

                {!isLoading && !error && !showFavoritesOnly && filteredOrders.length === 0 && (
                  <div className="bg-white border border-slate-200 p-10 text-center">
                    <ReceiptText className="w-14 h-14 text-gray-300 mx-auto mb-4" />
                    <h2 className="font-display text-2xl uppercase">{sortedOrders.length === 0 ? 'Nenhuma compra' : 'Nada encontrado'}</h2>
                    <p className="mt-2 font-mono text-xs uppercase text-gray-500">{sortedOrders.length === 0 ? 'Seus pedidos aparecerão aqui depois do checkout.' : 'Ajuste os filtros ou limpe a busca para ver mais resultados.'}</p>
                  </div>
                )}

                {!isLoading && !error && showFavoritesOnly && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visibleFavorites.length === 0 ? (
                      <div className="md:col-span-2 bg-white border border-slate-200 p-10 text-center">
                        <Heart className="w-14 h-14 text-gray-300 mx-auto mb-4" />
                        <h2 className="font-display text-2xl uppercase">Nenhum favorito</h2>
                        <p className="mt-2 font-mono text-xs uppercase text-gray-500">Salve fotos e videos na vitrine para acessar rapido por aqui.</p>
                      </div>
                    ) : visibleFavorites.map((item) => (
                      <FavoritePanelItem key={item.id} product={item} onAddToCart={onAddToCart} onToggleFavorite={onToggleFavorite} />
                    ))}
                  </div>
                )}

                {!isLoading && !error && !showFavoritesOnly && filteredOrders.map((order) => (
                  <article
                    key={order.id}
                    className={`bg-white border border-slate-200 shadow-sm p-4 md:p-5 space-y-4 ${highlightedOrderId === order.id ? 'ring-4 ring-brutal-accent' : ''
                      }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-display text-2xl uppercase">Pedido #{order.id.slice(0, 8)}</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase">
                          {new Date(order.createdAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <span className={`w-fit px-2 py-1 border font-mono text-[9px] uppercase ${statusClasses[order.status]}`}>
                        {statusLabels[order.status]}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div>
                        <p className="font-mono text-[10px] text-gray-400 uppercase">Total</p>
                        <p className="font-display text-4xl">{formatCurrency(Number(order.total))}</p>
                        {Number(order.discountTotal || 0) > 0 && (
                          <p className="font-mono text-[10px] uppercase text-green-700">
                            Você economizou {formatCurrency(Number(order.discountTotal || 0))}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {order.status === 'pending' && order.checkoutUrl && (
                          <a href={order.checkoutUrl} className="inline-flex items-center gap-2 bg-brutal-black text-white px-3 py-2 border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors">
                            Pagar novamente
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {order.status === 'paid' && (
                          <>
                            <button type="button" onClick={() => copyReceipt(order)} className="inline-flex items-center gap-2 bg-white text-brutal-black px-3 py-2 border border-slate-200 font-mono text-[10px] uppercase hover:bg-gray-50 transition-colors cursor-pointer">
                              Recibo
                              <Copy className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => downloadPaidOrder(order)} className="inline-flex items-center gap-2 bg-brutal-black text-white px-3 py-2 border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer">
                              Baixar tudo
                              <Download className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="border-t-2 border-gray-100 pt-4 space-y-3">
                      {(order.items ?? []).map((item) => (
                        <div key={item.id} className="grid grid-cols-[56px_1fr] gap-3 bg-slate-50 border border-slate-200 p-3 md:grid-cols-[64px_1fr_auto] md:items-center">
                          <div className="w-14 h-14 md:w-16 md:h-16 bg-brutal-black text-white border border-slate-200 overflow-hidden flex items-center justify-center">
                            <ProtectedMedia
                              src={item.thumbnailUrl || null}
                              alt={item.name}
                              type={item.type}
                              watermark={`FUNPACE ${order.id.slice(0, 8)}`}
                              mediaId={item.productId || item.id}
                              eventName={item.event}
                              imgClassName="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-display text-base uppercase truncate">{item.name}</p>
                            <p className="font-mono text-[9px] text-gray-400 uppercase truncate">
                              {[item.type, item.bib ? `Peito ${item.bib}` : '', item.event].filter(Boolean).join(' - ')}
                            </p>
                            <p className="font-display text-lg mt-1">{formatCurrency(Number(item.price))}</p>
                          </div>
                          <div className="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:justify-end">
                            {order.status === 'paid' && (
                              <>
                                <button type="button" onClick={() => openPaidItem(order, item)} className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 border border-slate-200 font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer">
                                  Abrir
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                                <button type="button" onClick={() => downloadPaidItem(order, item)} className="inline-flex items-center gap-2 bg-brutal-black text-white px-2 py-1 border border-brutal-black font-mono text-[9px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer">
                                  Baixar
                                  <Download className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            <button type="button" onClick={() => shareItem(item)} className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 border border-slate-200 font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer">
                              Compartilhar vitrine
                              <Share2 className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => onToggleFavorite?.(productFromOrderItem(item))} className="inline-flex items-center gap-2 bg-white text-brutal-black px-2 py-1 border border-slate-200 font-mono text-[9px] uppercase hover:bg-gray-50 transition-colors cursor-pointer">
                              Favoritar
                              <Heart className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <aside className="space-y-4">
                <div className="bg-white border border-slate-200 shadow-sm p-4">
                  <h2 className="font-display text-xl uppercase">Central do cliente</h2>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-start gap-3 border border-slate-200 bg-slate-50 p-3">
                      <ShieldCheck className="mt-0.5 w-4 h-4 text-green-600" />
                      <p className="font-mono text-[10px] uppercase leading-relaxed text-slate-500">Downloads passam por autorização do pedido pago antes de abrir o arquivo.</p>
                    </div>
                    <div className="flex items-start gap-3 border border-slate-200 bg-slate-50 p-3">
                      <CalendarDays className="mt-0.5 w-4 h-4 text-brutal-accent" />
                      <p className="font-mono text-[10px] uppercase leading-relaxed text-slate-500">Pedidos recentes aparecem primeiro e podem ser filtrados por status.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={loadOrders}
                    className="mt-4 w-full min-h-11 bg-brutal-black text-white border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Atualizar status
                  </button>
                </div>

                {pendingOrders.length > 0 && (
                  <div className="bg-white border border-slate-200 shadow-sm p-4">
                    <h2 className="font-display text-xl uppercase">Pendencias</h2>
                    <div className="mt-3 space-y-2">
                      {pendingOrders.slice(0, 3).map((order) => (
                        <div key={order.id} className="border border-yellow-200 bg-yellow-50 p-3">
                          <p className="font-display text-sm uppercase">Pedido #{order.id.slice(0, 8)}</p>
                          <p className="font-mono text-[9px] uppercase text-yellow-700">{formatCurrency(Number(order.total))}</p>
                          {order.checkoutUrl && (
                            <a href={order.checkoutUrl} className="mt-2 inline-flex items-center gap-2 bg-brutal-black px-2 py-1 text-white font-mono text-[9px] uppercase">
                              Pagar
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {paidItems.length > 0 && (
                  <div className="bg-white border border-slate-200 shadow-sm p-4">
                    <h2 className="font-display text-xl uppercase">Downloads recentes</h2>
                    <div className="mt-3 space-y-2">
                      {paidItems.slice(0, 5).map(({ order, item }) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => downloadPaidItem(order, item)}
                          className="w-full text-left border border-slate-200 bg-slate-50 p-3 hover:border-brutal-accent transition-colors cursor-pointer"
                        >
                          <p className="font-display text-sm uppercase truncate">{item.name}</p>
                          <p className="font-mono text-[9px] uppercase text-slate-400 truncate">#{order.id.slice(0, 8)} - {item.event}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {favoriteProducts.length > 0 && (
                  <div className="bg-white border border-slate-200 shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-brutal-accent fill-current" />
                      <h2 className="font-display text-xl uppercase">Favoritos</h2>
                    </div>
                    {favoriteProducts.slice(0, 6).map((item) => (
                      <div key={item.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-2">
                        <div className="w-10 h-10 bg-brutal-black text-white border border-slate-200 overflow-hidden flex items-center justify-center">
                          <ProtectedMedia
                            src={item.thumbnailUrl || null}
                            alt={item.name}
                            type={item.type}
                            watermark={`FUNPACE ${item.bib || item.id.slice(0, 6)}`}
                            mediaId={item.id}
                            eventName={item.event}
                            imgClassName="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-xs uppercase truncate">{item.name}</p>
                          <p className="font-mono text-[8px] text-gray-400 uppercase truncate">{formatCurrency(Number(item.price))}</p>
                        </div>
                        <button type="button" onClick={() => onAddToCart?.(item)} className="h-8 w-8 bg-brutal-black text-white border border-brutal-black inline-flex items-center justify-center hover:bg-brutal-accent transition-colors cursor-pointer" aria-label="Adicionar favorito ao carrinho">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
