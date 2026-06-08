import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  PackageCheck,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  UserCircle,
} from 'lucide-react';
import { Order, Product } from '../types';
import { customerAccountService, orderService } from '../lib/services';
import { getCurrentAccessToken, getCurrentUser, updateCurrentUserPassword, updateCurrentUserProfile } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { ProtectedMedia } from './ProtectedMedia';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function orderStatusLabel(status: Order['status']) {
  const labels: Record<Order['status'], string> = {
    pending: 'Aguardando pagamento',
    paid: 'Pago',
    failed: 'Falhou',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
    refused: 'Recusado',
    refunded: 'Reembolsado',
  };
  return labels[status];
}

function statusClass(status: Order['status']) {
  if (status === 'paid') return 'border-green-300 bg-green-50 text-green-700';
  if (status === 'pending') return 'border-yellow-300 bg-yellow-50 text-yellow-800';
  if (status === 'refunded') return 'border-blue-300 bg-blue-50 text-blue-700';
  return 'border-red-200 bg-red-50 text-red-700';
}

function itemToProduct(item: NonNullable<Order['items']>[number]): Product {
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
    throw new Error(payload?.error || 'Não foi possível liberar o download.');
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

export function CustomerAccountPage({
  favoriteProducts,
  onAddToCart,
  onToggleFavorite,
}: {
  favoriteProducts: Product[];
  onAddToCart: (product: Product) => void;
  onToggleFavorite: (product: Product) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const currentUser = getCurrentUser();
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [remoteFavorites, setRemoteFavorites] = React.useState<Product[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<'all' | Order['status']>('all');
  const [query, setQuery] = React.useState('');
  const [name, setName] = React.useState(currentUser?.displayName || '');
  const [avatarUrl, setAvatarUrl] = React.useState(currentUser?.photoURL || '');
  const [password, setPassword] = React.useState('');
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [downloadingItemId, setDownloadingItemId] = React.useState<string | null>(null);
  const [downloadError, setDownloadError] = React.useState<{ orderId: string; itemId: string; message: string } | null>(null);
  const highlightedOrderId = React.useMemo(() => new URLSearchParams(location.search).get('order'), [location.search]);

  const loadAccount = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [customerOrders, favorites] = await Promise.all([
        orderService.getCustomerOrders(100),
        customerAccountService.getFavorites(),
      ]);
      setOrders(customerOrders);
      setRemoteFavorites(favorites);
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível carregar sua conta.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const paidOrders = orders.filter((order) => order.status === 'paid');
  const paidItems = paidOrders.flatMap((order) => (order.items ?? []).map((item) => ({ order, item })));
  const totalSpent = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const recentEvents = Array.from(new Set(orders.flatMap((order) => (order.items ?? []).map((item) => item.event).filter(Boolean)))).slice(0, 5);
  const mergedFavorites = React.useMemo(() => {
    const map = new Map<string, Product>();
    [...remoteFavorites, ...favoriteProducts].forEach((product) => map.set(product.id, product));
    return Array.from(map.values());
  }, [favoriteProducts, remoteFavorites]);

  const filteredOrders = orders
    .filter((order) => statusFilter === 'all' || order.status === statusFilter)
    .filter((order) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return true;
      return [order.id, order.status, ...(order.items ?? []).flatMap((item) => [item.name, item.event, item.bib])]
        .some((value) => String(value || '').toLowerCase().includes(normalized));
    })
    .sort((left, right) => {
      if (highlightedOrderId && left.id === highlightedOrderId) return -1;
      if (highlightedOrderId && right.id === highlightedOrderId) return 1;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

  const saveProfile = async () => {
    setIsSavingProfile(true);
    try {
      await updateCurrentUserProfile({ name: name.trim(), avatarUrl: avatarUrl.trim() || undefined });
      await customerAccountService.upsertCustomerProfile({ name: name.trim(), avatarUrl: avatarUrl.trim() || null });
      showToast('Perfil atualizado.', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível atualizar o perfil.', 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (password.length < 8) {
      showToast('Use uma senha com pelo menos 8 caracteres.', 'error');
      return;
    }
    try {
      await updateCurrentUserPassword(password);
      setPassword('');
      showToast('Senha atualizada.', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível atualizar a senha.', 'error');
    }
  };

  const downloadItem = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    setDownloadingItemId(item.id);
    setDownloadError(null);
    try {
      const authorized = await authorizeDownload(order.id, item.id);
      triggerBrowserDownload(authorized.downloadUrl);
      showToast('Download iniciado.', 'success');
    } catch (error: any) {
      const message = error?.message || 'Download não autorizado.';
      setDownloadError({ orderId: order.id, itemId: item.id, message });
      showToast(message, 'error');
    } finally {
      setDownloadingItemId(null);
    }
  };

  const openItemForSaving = async (order: Order, item: NonNullable<Order['items']>[number]) => {
    setDownloadingItemId(item.id);
    setDownloadError(null);
    try {
      const authorized = await authorizeDownload(order.id, item.id);
      window.location.assign(authorized.saveUrl);
    } catch (error: any) {
      const message = error?.message || 'Não foi possível abrir a imagem.';
      setDownloadError({ orderId: order.id, itemId: item.id, message });
      showToast(message, 'error');
    } finally {
      setDownloadingItemId(null);
    }
  };

  const downloadOrder = async (order: Order) => {
    for (const item of order.items ?? []) {
      await downloadItem(order, item);
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-brutal-black">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brutal-accent">Área do cliente</p>
              <h1 className="mt-2 font-display text-5xl uppercase leading-none md:text-7xl">Minha Conta</h1>
              <p className="mt-3 max-w-2xl font-mono text-xs uppercase leading-relaxed text-slate-500">
                Pedidos, downloads, favoritos e dados da conta em um único lugar.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="min-h-11 bg-white px-4 border border-slate-200 font-mono text-[10px] uppercase hover:border-brutal-accent hover:text-brutal-accent inline-flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Continuar comprando
              </button>
              <button
                type="button"
                onClick={loadAccount}
                className="min-h-11 bg-brutal-black px-4 text-white border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent inline-flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Atualizar
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        {isLoading ? (
          <AccountSkeleton />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Pedidos" value={String(orders.length)} icon={<PackageCheck className="w-5 h-5" />} />
              <Metric label="Fotos compradas" value={String(paidItems.length)} icon={<ImageIcon className="w-5 h-5" />} />
              <Metric label="Total investido" value={formatCurrency(totalSpent)} icon={<ShoppingCart className="w-5 h-5" />} dark />
              <Metric label="Conta" value={currentUser?.email ? 'Ativa' : 'Login'} icon={<CheckCircle2 className="w-5 h-5" />} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-6">
                <Panel title="Meus pedidos" icon={<PackageCheck className="w-5 h-5" />}>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="BUSCAR POR EVENTO, PEDIDO OU PEITO"
                        className="h-11 w-full border border-slate-200 bg-slate-50 pl-10 pr-4 font-mono text-[10px] uppercase outline-none focus:border-brutal-accent focus:bg-white"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'pending', 'paid', 'refused', 'canceled'] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setStatusFilter(status)}
                          className={`min-h-9 border px-3 font-mono text-[9px] uppercase ${statusFilter === status ? 'border-brutal-black bg-brutal-black text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-brutal-accent'}`}
                        >
                          {status === 'all' ? 'Todos' : status}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {filteredOrders.length === 0 ? (
                      <EmptyState title="Nenhum pedido encontrado" text="Ajuste os filtros ou continue comprando para montar seu histórico." />
                    ) : filteredOrders.slice(0, 12).map((order) => (
                      <article key={order.id} className={`border bg-slate-50 p-4 ${highlightedOrderId === order.id ? 'border-brutal-accent ring-4 ring-brutal-accent/20' : 'border-slate-200'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-display text-xl uppercase">Pedido #{order.id.slice(0, 8)}</p>
                            <p className="font-mono text-[10px] uppercase text-slate-400">
                              {formatDate(order.createdAt)} - {order.paymentMethod || 'checkout'} - {formatCurrency(Number(order.total))}
                            </p>
                          </div>
                          <span className={`w-fit border px-2 py-1 font-mono text-[9px] uppercase ${statusClass(order.status)}`}>
                            {orderStatusLabel(order.status)}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {(order.items ?? []).slice(0, 4).map((item) => (
                            <div key={item.id} className="flex items-center gap-3 bg-white border border-slate-200 p-2">
                              <div className="h-12 w-12 overflow-hidden bg-brutal-black">
                                <ProtectedMedia src={item.thumbnailUrl || null} alt={item.name} type={item.type} watermark={`FUNPACE ${item.bib || item.id.slice(0, 6)}`} mediaId={item.productId || item.id} eventName={item.event} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-display text-sm uppercase truncate">{item.name}</p>
                                <p className="font-mono text-[9px] uppercase text-slate-400 truncate">{item.event}</p>
                              </div>
                              {order.status === 'paid' && (
                                <button type="button" disabled={downloadingItemId === item.id} onClick={() => downloadItem(order, item)} className="h-8 w-8 border border-slate-200 bg-white inline-flex items-center justify-center hover:border-brutal-accent disabled:opacity-60">
                                  {downloadingItemId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {downloadError?.orderId === order.id && (
                          <div className="mt-3 border border-red-200 bg-red-50 p-3">
                            <p className="font-mono text-[10px] uppercase text-red-700">{downloadError.message}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button type="button" onClick={() => {
                                const retryItem = (order.items ?? []).find((orderItem) => orderItem.id === downloadError.itemId);
                                if (retryItem) downloadItem(order, retryItem);
                              }} className="min-h-8 border border-red-300 bg-white px-2 font-mono text-[9px] uppercase text-red-700">
                                Tentar novamente
                              </button>
                              <button type="button" onClick={() => {
                                const retryItem = (order.items ?? []).find((orderItem) => orderItem.id === downloadError.itemId);
                                if (retryItem) openItemForSaving(order, retryItem);
                              }} className="min-h-8 border border-slate-200 bg-white px-2 font-mono text-[9px] uppercase text-slate-700">
                                Abrir para salvar
                              </button>
                            </div>
                          </div>
                        )}
                        {order.status === 'paid' ? (
                          <button type="button" onClick={() => downloadOrder(order)} className="mt-3 min-h-10 bg-brutal-black px-3 text-white border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent inline-flex items-center gap-2">
                            <Download className="w-3 h-3" />
                            Baixar fotos
                          </button>
                        ) : (
                          <p className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase text-slate-500">
                            <Clock3 className="w-3 h-3" />
                            {order.status === 'pending' ? 'Aguardando confirmação do pagamento' : 'Pedido sem download liberado'}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </Panel>

                <Panel title="Downloads liberados" icon={<Download className="w-5 h-5" />}>
                  {paidItems.length === 0 ? (
                    <EmptyState title="Nenhum download liberado" text="Assim que um pagamento for aprovado, os arquivos aparecem aqui." />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {paidItems.slice(0, 10).map(({ order, item }) => (
                        <button key={`${order.id}-${item.id}`} type="button" disabled={downloadingItemId === item.id} onClick={() => downloadItem(order, item)} className="text-left border border-slate-200 bg-slate-50 p-3 hover:border-brutal-accent disabled:opacity-60">
                          <p className="font-display text-base uppercase truncate">{item.name}</p>
                          <p className="mt-1 font-mono text-[9px] uppercase text-slate-400 truncate">{item.event} - {formatDate(order.createdAt)}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>

              <aside className="space-y-6">
                <Panel title="Perfil" icon={<UserCircle className="w-5 h-5" />}>
                  <div className="space-y-3">
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" className="h-11 w-full border border-slate-200 bg-white px-3 font-mono text-xs uppercase outline-none focus:border-brutal-accent" />
                    <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="URL DO AVATAR" className="h-11 w-full border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-brutal-accent" />
                    <button type="button" onClick={saveProfile} disabled={isSavingProfile} className="min-h-11 w-full bg-brutal-black text-white border border-brutal-black font-mono text-[10px] uppercase hover:bg-brutal-accent inline-flex items-center justify-center gap-2">
                      {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                      Salvar perfil
                    </button>
                  </div>
                </Panel>

                <Panel title="Segurança" icon={<Lock className="w-5 h-5" />}>
                  <div className="space-y-3">
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="NOVA SENHA" className="h-11 w-full border border-slate-200 bg-white px-3 font-mono text-xs uppercase outline-none focus:border-brutal-accent" />
                    <button type="button" onClick={savePassword} className="min-h-11 w-full bg-white text-brutal-black border border-slate-200 font-mono text-[10px] uppercase hover:border-brutal-accent inline-flex items-center justify-center gap-2">
                      Atualizar senha
                    </button>
                  </div>
                </Panel>

                <Panel title="Favoritos" icon={<Heart className="w-5 h-5" />}>
                  {mergedFavorites.length === 0 ? (
                    <EmptyState title="Sem favoritos" text="Favorite fotos na vitrine para comprar depois." compact />
                  ) : (
                    <div className="space-y-2">
                      {mergedFavorites.slice(0, 6).map((product) => (
                        <div key={product.id} className="flex items-center gap-3 border border-slate-200 bg-slate-50 p-2">
                          <div className="h-10 w-10 overflow-hidden bg-brutal-black">
                            <ProtectedMedia src={product.thumbnailUrl || null} alt={product.name} type={product.type} watermark="FUNPACE" mediaId={product.id} eventName={product.event} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-display text-xs uppercase truncate">{product.name}</p>
                            <p className="font-mono text-[8px] uppercase text-slate-400 truncate">{formatCurrency(product.price)}</p>
                          </div>
                          <button type="button" onClick={() => onAddToCart(product)} className="h-8 w-8 bg-brutal-black text-white inline-flex items-center justify-center">
                            <ShoppingCart className="w-3 h-3" />
                          </button>
                          <button type="button" onClick={() => onToggleFavorite(product)} className="h-8 w-8 bg-white border border-slate-200 inline-flex items-center justify-center">
                            <Heart className="w-3 h-3 fill-current text-brutal-accent" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel title="Eventos recentes" icon={<Camera className="w-5 h-5" />}>
                  {recentEvents.length === 0 ? (
                    <EmptyState title="Sem eventos" text="Seu histórico de eventos aparece após as compras." compact />
                  ) : (
                    <div className="space-y-2">
                      {recentEvents.map((eventName) => (
                        <button key={eventName} type="button" onClick={() => navigate(`/eventos/${eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)} className="w-full border border-slate-200 bg-slate-50 p-3 text-left hover:border-brutal-accent">
                          <p className="font-display text-sm uppercase truncate">{eventName}</p>
                          <p className="mt-1 inline-flex items-center gap-1 font-mono text-[9px] uppercase text-slate-400">Ver fotos <ArrowRight className="w-3 h-3" /></p>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              </aside>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 shadow-sm p-4 md:p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-brutal-accent">{icon}</span>
        <h2 className="font-display text-xl uppercase">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, icon, dark = false }: { label: string; value: string; icon: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`border p-4 shadow-sm ${dark ? 'border-brutal-black bg-brutal-black text-white' : 'border-slate-200 bg-white text-brutal-black'}`}>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase text-current opacity-60">{label}</p>
        <span className={dark ? 'text-brutal-accent' : 'text-slate-400'}>{icon}</span>
      </div>
      <p className="font-display text-2xl uppercase">{value}</p>
    </div>
  );
}

function EmptyState({ title, text, compact = false }: { title: string; text: string; compact?: boolean }) {
  return (
    <div className={`border border-dashed border-slate-200 bg-slate-50 text-center ${compact ? 'p-5' : 'p-8'}`}>
      <p className="font-display text-lg uppercase text-slate-500">{title}</p>
      <p className="mt-2 font-mono text-[10px] uppercase leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-96 animate-pulse border border-slate-200 bg-white" />
        <div className="h-96 animate-pulse border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
