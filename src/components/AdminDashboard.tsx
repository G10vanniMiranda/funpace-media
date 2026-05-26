import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  Users, 
  Camera, 
  DollarSign, 
  TrendingUp, 
  LogOut, 
  Settings, 
  Search, 
  MoreVertical,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  Download,
  Filter,
  BarChart3,
  Plus,
  X,
  Mail,
  User as UserIcon,
  ShoppingCart
} from 'lucide-react';
import { AdminMetrics, Order, Photographer, PlatformSettings, Product, WithdrawalRequest } from '../types';
import { orderService, photographerService, platformSettingsService, productService, withdrawalService } from '../lib/services';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../lib/cpf';

interface AdminDashboardProps {
  photographers: Photographer[];
  photos: Product[];
  videos: Product[];
  orders: Order[];
  withdrawals: WithdrawalRequest[];
  metrics: AdminMetrics;
  onLogout: () => void;
  onRefresh: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

async function createThumbnailFromMedia(product: Product): Promise<File> {
  const sourceUrl = product.thumbnailUrl || product.url;
  const response = await fetch(sourceUrl, { mode: 'cors' });
  if (!response.ok) throw new Error('Nao foi possivel baixar a midia para gerar preview.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    if (product.type === 'IMG') {
      return await new Promise<File>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const maxSide = 1000;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Canvas indisponivel.'));
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          canvas.toBlob((thumbBlob) => {
            if (!thumbBlob) {
              reject(new Error('Nao foi possivel gerar preview.'));
              return;
            }
            resolve(new File([thumbBlob], `${product.id}-preview.jpg`, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.78);
        };
        image.onerror = () => reject(new Error('Imagem invalida.'));
        image.src = objectUrl;
      });
    }

    return await new Promise<File>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;
      video.onerror = () => reject(new Error('Video invalido.'));
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, Math.max(0, (video.duration || 1) / 4));
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Canvas indisponivel.'));
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((thumbBlob) => {
          if (!thumbBlob) {
            reject(new Error('Nao foi possivel gerar preview.'));
            return;
          }
          resolve(new File([thumbBlob], `${product.id}-preview.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.78);
      };
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function AdminDashboard({ photographers, photos, videos, orders, withdrawals, metrics, onLogout, onRefresh }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'photographers' | 'sales' | 'settings'>('overview');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPhotographer, setNewPhotographer] = useState({ name: '', email: '', bio: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openMenuPhotographerId, setOpenMenuPhotographerId] = useState<string | null>(null);
  const [editingPhotographer, setEditingPhotographer] = useState<Photographer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', bio: '', cpf: '', phone: '', avatar: '' });
  const [isUpdatingPhotographer, setIsUpdatingPhotographer] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [updatingWithdrawalId, setUpdatingWithdrawalId] = useState<string | null>(null);
  const [isBackfillingThumbnails, setIsBackfillingThumbnails] = useState(false);
  const [thumbnailBackfillProgress, setThumbnailBackfillProgress] = useState('');
  const [settingsForm, setSettingsForm] = useState<Pick<PlatformSettings, 'platformFeePercent' | 'withdrawalFee' | 'autoBlockSuspicious'>>({
    platformFeePercent: 30,
    withdrawalFee: 5,
    autoBlockSuspicious: true,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const pendingPhotographers = photographers.filter(p => !p.verified);
  const activePhotographers = photographers.filter(p => p.verified);
  const recentOrders = orders.slice(0, 5);
  const pendingOrders = orders.filter((order) => order.status === 'pending');
  const paidOrders = orders.filter((order) => order.status === 'paid');
  const productsMissingThumbnails = [...photos, ...videos].filter((product) => !product.thumbnailUrl && (product.status ?? 'published') !== 'removed');
  const pendingWithdrawals = withdrawals.filter((withdrawal) => withdrawal.status === 'pending');
  const processedWithdrawals = withdrawals.filter((withdrawal) => withdrawal.status !== 'pending');
  const photographerById = React.useMemo(
    () => new Map(photographers.map((photographer) => [photographer.id, photographer])),
    [photographers],
  );
  const recentActivity = React.useMemo(() => {
    type Activity = { id: string; kind: 'photographer' | 'product' | 'order'; at: number; title: string; meta: string };

    const toTs = (iso?: string) => {
      const t = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(t) ? t : 0;
    };

    const timeAgo = (ts: number) => {
      if (!ts) return 'Agora';
      const diffMs = Date.now() - ts;
      const min = Math.max(0, Math.floor(diffMs / 60000));
      if (min < 1) return 'Agora';
      if (min < 60) return `Ha ${min} minuto${min === 1 ? '' : 's'}`;
      const h = Math.floor(min / 60);
      if (h < 24) return `Ha ${h} hora${h === 1 ? '' : 's'}`;
      const d = Math.floor(h / 24);
      return `Ha ${d} dia${d === 1 ? '' : 's'}`;
    };

    const activities: Activity[] = [];

    for (const p of photographers) {
      const at = toTs(p.createdAt);
      if (!at) continue;
      activities.push({
        id: `p:${p.id}`,
        kind: 'photographer',
        at,
        title: `Novo fotografo cadastrado: ${p.name}`,
        meta: `${timeAgo(at)} • Sistema`,
      });
    }

    for (const prod of [...photos, ...videos]) {
      const at = toTs(prod.createdAt);
      if (!at) continue;
      const label = prod.type === 'IMG' ? 'Nova foto publicada' : 'Novo video publicado';
      const eventLabel = prod.event || 'Geral';
      activities.push({
        id: `m:${prod.id}`,
        kind: 'product',
        at,
        title: `${label}: ${eventLabel}`,
        meta: `${timeAgo(at)} • Catalogo`,
      });
    }

    for (const o of orders) {
      const at = toTs(o.createdAt);
      if (!at) continue;
      const label = o.status === 'paid'
        ? `Novo pagamento confirmado: Pedido #${o.id.slice(0, 8)}`
        : o.status === 'pending'
          ? `Novo checkout iniciado: Pedido #${o.id.slice(0, 8)}`
          : `Atualizacao de pedido: #${o.id.slice(0, 8)}`;
      activities.push({
        id: `o:${o.id}`,
        kind: 'order',
        at,
        title: label,
        meta: `${timeAgo(at)} • Pagamentos`,
      });
    }

    return activities
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);
  }, [photographers, photos, videos, orders]);
  const eventReports = React.useMemo(() => {
    const reports = new Map<string, { event: string; items: number; orders: Set<string>; revenue: number }>();

    for (const order of paidOrders) {
      for (const item of order.items ?? []) {
        const event = item.event || 'Geral';
        const current = reports.get(event) ?? { event, items: 0, orders: new Set<string>(), revenue: 0 };
        current.items += 1;
        current.orders.add(order.id);
        current.revenue += Number(item.price || 0);
        reports.set(event, current);
      }
    }

    return Array.from(reports.values())
      .map((report) => ({ ...report, ordersCount: report.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [paidOrders]);
  const photographerReports = React.useMemo(() => {
    const photographersById = new Map(photographers.map((photographer) => [photographer.id, photographer]));
    const reports = new Map<string, { photographerId: string; name: string; items: number; orders: Set<string>; revenue: number }>();

    for (const order of paidOrders) {
      for (const item of order.items ?? []) {
        const photographer = photographersById.get(item.vendedorId);
        const current = reports.get(item.vendedorId) ?? {
          photographerId: item.vendedorId,
          name: photographer?.name ?? item.vendedorId,
          items: 0,
          orders: new Set<string>(),
          revenue: 0,
        };
        current.items += 1;
        current.orders.add(order.id);
        current.revenue += Number(item.price || 0);
        reports.set(item.vendedorId, current);
      }
    }

    return Array.from(reports.values())
      .map((report) => ({ ...report, ordersCount: report.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [paidOrders, photographers]);
  const storageUsagePercent = metrics.totalProducts === 0
    ? 0
    : Math.min(100, Math.round((metrics.publishedProducts / Math.max(metrics.totalProducts, 1)) * 100));
  const paidConversionPercent = metrics.totalOrders === 0
    ? 0
    : Math.round((metrics.paidOrders / metrics.totalOrders) * 1000) / 10;

  React.useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await platformSettingsService.getSettings();
        setSettingsForm({
          platformFeePercent: Number(settings.platformFeePercent),
          withdrawalFee: Number(settings.withdrawalFee),
          autoBlockSuspicious: Boolean(settings.autoBlockSuspicious),
        });
      } catch (error) {
        console.error('Erro ao carregar configuracoes:', error);
      }
    }

    loadSettings();
  }, []);

  React.useEffect(() => {
    if (!openMenuPhotographerId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-photographer-menu]')) return;
      setOpenMenuPhotographerId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMenuPhotographerId]);

  const handleVerifyPhotographer = async (id: string) => {
    try {
      await photographerService.verifyPhotographer(id);
      onRefresh();
      alert("Fotógrafo aprovado com sucesso!");
    } catch (error) {
      console.error(error);
      alert("Erro ao aprovar fotógrafo.");
    }
  };

  const handleAddPhotographer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await photographerService.addPhotographer({
        name: newPhotographer.name,
        email: newPhotographer.email,
        bio: newPhotographer.bio,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(newPhotographer.name)}&background=random`,
        stats: {
          photos: 0,
          events: 0,
          rating: 5.0,
          totalEarnings: 0,
          pendingEarnings: 0,
          salesCount: 0
        }
      });
      
      onRefresh();
      setShowAddModal(false);
      setNewPhotographer({ name: '', email: '', bio: '' });
      alert("Fotógrafo cadastrado e aguardando aprovação!");
    } catch (error) {
      console.error(error);
      alert("Erro ao cadastrar fotógrafo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditPhotographer = (photographer: Photographer) => {
    setEditingPhotographer(photographer);
    setEditForm({
      name: photographer.name ?? '',
      bio: photographer.bio ?? '',
      cpf: formatCpf(photographer.cpf ?? ''),
      phone: photographer.phone ?? '',
      avatar: photographer.avatar ?? '',
    });
    setOpenMenuPhotographerId(null);
  };

  const handleSavePhotographer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPhotographer) return;

    const cpfDigits = onlyCpfDigits(editForm.cpf);
    if (cpfDigits && !isValidCpf(cpfDigits)) {
      alert('CPF invalido.');
      return;
    }

    setIsUpdatingPhotographer(true);
    try {
      await photographerService.updatePhotographerAdmin(editingPhotographer.id, {
        name: editForm.name.trim(),
        bio: editForm.bio,
        cpf: cpfDigits || null,
        phone: editForm.phone.trim() || null,
        avatar: editForm.avatar.trim() || editingPhotographer.avatar,
      } as any);
      await onRefresh();
      setEditingPhotographer(null);
      alert('Fotografo atualizado com sucesso.');
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar fotografo.');
    } finally {
      setIsUpdatingPhotographer(false);
    }
  };

  const handleDisablePhotographer = async (photographer: Photographer) => {
    const confirmed = window.confirm(
      `Excluir/desativar o fotografo "${photographer.name}"? Isso remove o acesso ao painel e mantem historico de pedidos.`,
    );
    if (!confirmed) return;

    setIsUpdatingPhotographer(true);
    try {
      await photographerService.updatePhotographerAdmin(photographer.id, { verified: false });
      await onRefresh();
      setOpenMenuPhotographerId(null);
      alert('Fotografo desativado.');
    } catch (error) {
      console.error(error);
      alert('Erro ao desativar fotografo.');
    } finally {
      setIsUpdatingPhotographer(false);
    }
  };

  const handleManualOrderStatus = async (order: Order, status: Order['status']) => {
    const actionLabel = status === 'paid' ? 'confirmar pagamento' : 'cancelar pedido';
    const confirmed = window.confirm(`Deseja ${actionLabel} do pedido #${order.id.slice(0, 8)}?`);
    if (!confirmed) return;

    setUpdatingOrderId(order.id);
    try {
      await orderService.updateOrderStatus(order.id, status);
      await onRefresh();
      alert(status === 'paid' ? 'Pagamento confirmado manualmente.' : 'Pedido atualizado.');
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar pedido.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleWithdrawalStatus = async (withdrawal: WithdrawalRequest, status: WithdrawalRequest['status']) => {
    const photographer = photographerById.get(withdrawal.photographerId);
    const actionLabel = status === 'paid' ? 'marcar como pago' : 'recusar';
    const confirmed = window.confirm(
      `Deseja ${actionLabel} o saque de ${formatCurrency(Number(withdrawal.amount))}${photographer ? ` para ${photographer.name}` : ''}?`,
    );
    if (!confirmed) return;

    setUpdatingWithdrawalId(withdrawal.id);
    try {
      await withdrawalService.updateWithdrawalStatus(
        withdrawal.id,
        status,
        status === 'paid' ? 'Transferencia Pix realizada pelo admin.' : 'Solicitacao recusada pelo admin.',
      );
      await onRefresh();
      alert(status === 'paid' ? 'Saque marcado como pago.' : 'Saque recusado.');
    } catch (error) {
      console.error(error);
      alert('Erro ao atualizar saque.');
    } finally {
      setUpdatingWithdrawalId(null);
    }
  };

  const handleBackfillThumbnails = async () => {
    const targets = productsMissingThumbnails.slice(0, 25);
    if (targets.length === 0) return;

    const confirmed = window.confirm(`Gerar previews para ${targets.length} produto(s) sem thumbnail?`);
    if (!confirmed) return;

    setIsBackfillingThumbnails(true);
    setThumbnailBackfillProgress(`0/${targets.length}`);

    let completed = 0;
    let failed = 0;

    try {
      for (const product of targets) {
        try {
          const thumbnail = await createThumbnailFromMedia(product);
          const uploaded = await productService.uploadProductThumbnail(product.vendedorId, thumbnail);
          await productService.updateProductThumbnail(product.id, uploaded.path);
          completed += 1;
        } catch (error) {
          failed += 1;
          console.error(`Erro ao gerar preview do produto ${product.id}:`, error);
        }
        setThumbnailBackfillProgress(`${completed + failed}/${targets.length}`);
      }

      await onRefresh();
      alert(failed > 0
        ? `Previews gerados: ${completed}. Falhas: ${failed}.`
        : `Previews gerados com sucesso: ${completed}.`);
    } finally {
      setIsBackfillingThumbnails(false);
    }
  };

  const handleSaveSettings = async () => {
    if (settingsForm.platformFeePercent < 0 || settingsForm.platformFeePercent > 100) {
      alert('A taxa da plataforma deve ficar entre 0 e 100%.');
      return;
    }

    if (settingsForm.withdrawalFee < 0) {
      alert('A taxa de saque nao pode ser negativa.');
      return;
    }

    setIsSavingSettings(true);
    try {
      const updated = await platformSettingsService.updateSettings(settingsForm);
      setSettingsForm({
        platformFeePercent: Number(updated.platformFeePercent),
        withdrawalFee: Number(updated.withdrawalFee),
        autoBlockSuspicious: Boolean(updated.autoBlockSuspicious),
      });
      alert('Configuracoes salvas com sucesso.');
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar configuracoes.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#080d14] font-sans text-white">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-[#05080d] text-white border-r border-white/10 flex flex-col shadow-[20px_0_60px_rgba(0,0,0,0.35)]">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <div className="bg-brutal-accent p-2 brutal-border-thin border-brutal-accent shadow-[0_0_24px_rgba(255,78,0,0.35)]">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-normal">ADMIN</h1>
            <p className="font-mono text-[10px] text-brutal-accent uppercase tracking-widest">Control Center</p>
          </div>
        </div>

        <nav className="flex-1 p-5 space-y-3">
          <AdminSidebarLink 
            icon={<BarChart3 />} 
            label="Visão Geral" 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')} 
          />
          <AdminSidebarLink 
            icon={<Users />} 
            label="Fotógrafos" 
            active={activeTab === 'photographers'} 
            onClick={() => setActiveTab('photographers')} 
          />
          <AdminSidebarLink 
            icon={<DollarSign />} 
            label="Financeiro" 
            active={activeTab === 'sales'} 
            onClick={() => setActiveTab('sales')} 
          />
          <AdminSidebarLink 
            icon={<Settings />} 
            label="Configurações" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="p-5 border-t border-white/10 space-y-4">
          <div className="bg-white/5 border border-white/10 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-display">A</div>
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase truncate">Administrador</p>
              <p className="font-mono text-[10px] text-gray-500 truncate">admin@funpace.media</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-3 py-4 bg-transparent border border-white/10 font-mono text-xs uppercase font-bold hover:bg-red-500 hover:border-red-500 transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sair do Admin
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-5 md:p-8 overflow-y-auto">
        <header className="mb-8 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div>
            <h2 className="font-sans font-black text-3xl md:text-4xl tracking-normal normal-case mb-2">
              {activeTab === 'overview' && 'Painel Administrativo'}
              {activeTab === 'photographers' && 'Gestão de Artistas'}
              {activeTab === 'sales' && 'Fluxo de Caixa'}
              {activeTab === 'settings' && 'Preferências'}
            </h2>
            <div className="flex items-center gap-2 font-mono text-sm text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Sistema Online • Versão 2.4.0
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
            <div className="h-12 px-4 bg-[#0d131c] border border-white/15 flex items-center justify-between sm:justify-start gap-4 min-w-0 sm:min-w-[280px]">
              <div className="flex items-center gap-3 min-w-0">
                <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-sans text-sm text-gray-200 truncate">20/05/2024 - 26/05/2024</span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
            </div>
            <div className="h-12 px-4 bg-[#0d131c] border border-white/15 flex items-center gap-4">
              <div className="relative">
                <Bell className="w-5 h-5 text-gray-300" />
                <span className="absolute -right-2 -top-2 h-5 min-w-5 px-1 rounded-full bg-brutal-accent text-white font-sans text-[10px] font-black flex items-center justify-center">3</span>
              </div>
              <div className="h-7 w-px bg-white/10" />
              <div>
                <p className="font-mono text-[9px] text-gray-500 uppercase tracking-widest">Uptime</p>
                <p className="font-sans text-sm font-black text-white">99.9%</p>
              </div>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <button className="h-12 px-5 bg-brutal-accent text-white border border-brutal-accent font-sans text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-white hover:text-brutal-accent transition-colors">
              <Download className="w-4 h-4" />
              Exportar relatorio
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              <div className="bg-[#0d131c] border border-white/10 p-4 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mr-2">Periodo</span>
                {['Hoje', 'Esta semana', 'Este mes', 'Este ano', 'Personalizado'].map((label) => (
                  <button
                    key={label}
                    className={`h-10 px-4 border font-mono text-xs uppercase transition-colors ${
                      label === 'Esta semana'
                        ? 'bg-brutal-accent/20 border-brutal-accent text-white'
                        : 'bg-[#080d14] border-white/10 text-gray-300 hover:border-white/30'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <AdminStatCard 
                  label="GMV (Volume Bruto)" 
                  value={`R$ ${metrics.grossRevenue.toFixed(2)}`} 
                  icon={<DollarSign />} 
                  sub="Acumulado este mês"
                  accent
                />
                <AdminStatCard 
                  label="Receita Líquida (Fees)" 
                  value={`R$ ${metrics.platformFee.toFixed(2)}`} 
                  icon={<TrendingUp />} 
                  sub="Margem de 30%"
                />
                <AdminStatCard 
                  label="Total Fotógrafos" 
                  value={photographers.length} 
                  icon={<Users />} 
                  sub={`${pendingPhotographers.length} pendentes de aprovação`}
                />
                <AdminStatCard 
                  label="Total Vídeos" 
                  value={metrics.videoCount} 
                  icon={<Camera />} 
                  sub="Replays em 4k"
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr_0.95fr] gap-5">
                <div className="bg-[#0d131c] p-6 border border-white/10">
                  <h3 className="font-sans font-black text-base mb-6 uppercase flex items-center justify-between">
                    Atividade Recente
                    <span className="font-mono text-[10px] text-gray-500 uppercase font-normal">Ver todas</span>
                  </h3>
                  <div className="space-y-6">
                    {recentActivity.length === 0 ? (
                      <div className="p-6 bg-white/5 border border-white/10 text-center">
                        <p className="font-mono text-[10px] text-gray-400 uppercase">Nenhuma atividade recente encontrada.</p>
                      </div>
                    ) : (
                      recentActivity.map((activity) => (
                        <div key={activity.id} className="flex items-center gap-4 pb-5 border-b border-white/10 last:border-0 last:pb-0">
                          <div className={`p-3 border rounded-md ${
                            activity.kind === 'product' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                              : activity.kind === 'photographer' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                : 'bg-green-500/10 border-green-500/20 text-green-400'
                          }`}>
                            {activity.kind === 'product'
                              ? <Camera className="w-5 h-5" />
                              : activity.kind === 'photographer'
                                ? <Users className="w-5 h-5" />
                                : <DollarSign className="w-5 h-5" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-sans font-bold text-sm truncate text-white">{activity.title}</p>
                            <p className="font-mono text-[10px] text-gray-400 uppercase">{activity.meta}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-[#0d131c] p-6 border border-white/10 space-y-6">
                  <h3 className="font-sans font-black text-base uppercase">Manutencao de Midias</h3>
                  <div className="bg-[#080d14] border border-dashed border-white/20 p-5 flex flex-col md:items-center justify-between gap-4 text-center">
                    <div>
                      <p className="font-sans font-bold text-lg uppercase">Previews antigos</p>
                      <p className="font-mono text-[10px] uppercase text-gray-500 mt-1">
                        {productsMissingThumbnails.length} produto(s) sem thumbnail dedicado.
                      </p>
                      {thumbnailBackfillProgress && (
                        <p className="font-mono text-[10px] uppercase text-brutal-accent mt-2">
                          Processando {thumbnailBackfillProgress}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleBackfillThumbnails}
                      disabled={isBackfillingThumbnails || productsMissingThumbnails.length === 0}
                      className="h-12 px-5 bg-transparent text-brutal-accent border border-brutal-accent font-display text-sm uppercase tracking-widest hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer disabled:border-gray-700 disabled:text-gray-600 disabled:cursor-not-allowed"
                    >
                      {isBackfillingThumbnails ? 'Gerando...' : 'Gerar Previews'}
                    </button>
                  </div>
                  <p className="font-mono text-[10px] uppercase leading-relaxed text-gray-400">
                    Processa ate 25 itens por vez. Reexecute ate zerar a fila.
                  </p>
                </div>

                <div className="bg-[#0d131c] text-white p-6 border border-white/10">
                  <h3 className="font-display text-2xl mb-6 uppercase">Saúde da Plataforma</h3>
                  <div className="space-y-8">
                    <div className="space-y-2">
                      <div className="flex justify-between font-mono text-[10px] uppercase">
                        <span>Ocupação do Storage</span>
                        <span>{storageUsagePercent}%</span>
                      </div>
                      <div className="h-3 bg-white/10 overflow-hidden rounded-full">
                        <div className="h-full bg-brutal-accent" style={{ width: `${storageUsagePercent}%` }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between font-mono text-[10px] uppercase">
                        <span>Conversão de Vendas</span>
                        <span>{paidConversionPercent}%</span>
                      </div>
                      <div className="h-3 bg-white/10 overflow-hidden rounded-full">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, paidConversionPercent)}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <div className="p-4 bg-white/5 border border-white/10 text-center text-brutal-accent">
                         <p className="font-display text-3xl">{metrics.totalProducts}</p>
                         <p className="font-mono text-[8px] uppercase">Produtos</p>
                      </div>
                      <div className="p-4 bg-white/5 border border-white/10 text-center text-green-500">
                         <p className="font-display text-3xl">{metrics.totalOrders}</p>
                         <p className="font-mono text-[8px] uppercase">Pedidos</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ReportCard
                  title="Receita por Evento"
                  emptyLabel="Nenhuma venda paga por evento."
                  rows={eventReports.map((report) => ({
                    id: report.event,
                    title: report.event,
                    subtitle: `${report.ordersCount} pedidos - ${report.items} itens`,
                    value: `R$ ${report.revenue.toFixed(2)}`,
                  }))}
                />
                <ReportCard
                  title="Receita por Fotografo"
                  emptyLabel="Nenhuma venda paga por fotografo."
                  rows={photographerReports.map((report) => ({
                    id: report.photographerId,
                    title: report.name,
                    subtitle: `${report.ordersCount} pedidos - ${report.items} itens`,
                    value: `R$ ${report.revenue.toFixed(2)}`,
                  }))}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'photographers' && (
            <motion.div
              key="photographers"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input 
                    type="text" 
                    placeholder="BUSCAR FOTÓGRAFOS POR NOME, EMAIL OU ID..." 
                    className="w-full h-16 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent transition-all outline-none"
                  />
                </div>
                <div className="flex gap-4">
                  <button className="bg-white px-8 brutal-border flex items-center gap-3 font-mono text-xs font-bold uppercase hover:bg-gray-50 cursor-pointer">
                    <Filter className="w-5 h-5" />
                    Filtrar
                  </button>
                  <button 
                    onClick={() => setShowAddModal(true)}
                    className="bg-brutal-accent text-white px-8 brutal-border shadow-[4px_4px_0_#000] flex items-center gap-3 font-display uppercase tracking-widest hover:-translate-x-1 hover:-translate-y-1 transition-all cursor-pointer"
                  >
                    <Plus className="w-5 h-5" />
                    Novo Fotógrafo
                  </button>
                </div>
              </div>

              <div className="bg-white brutal-border overflow-visible relative">
                <table className="w-full text-left font-mono text-sm">
                  <thead className="bg-brutal-black text-white uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="p-6">Fotógrafo</th>
                      <th className="p-6">Status</th>
                      <th className="p-6 text-center">Fotos</th>
                      <th className="p-6 text-center">Receita Gerada</th>
                      <th className="p-6 text-center">Score</th>
                      <th className="p-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-gray-100">
                    {photographers.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-6">
                          <div className="flex items-center gap-4">
                            <img src={p.avatar} alt="" className="w-10 h-10 border-2 border-brutal-black grayscale" />
                            <div>
                              <p className="font-display text-lg uppercase leading-none mb-1">{p.name}</p>
                              <p className="text-[10px] text-gray-400 lowercase">{p.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-6">
                          {p.verified ? (
                            <span className="bg-green-100 text-green-700 px-3 py-1 brutal-border-thin text-[9px] font-bold uppercase">Ativo</span>
                          ) : (
                            <span className="bg-yellow-100 text-yellow-700 px-3 py-1 brutal-border-thin text-[9px] font-bold uppercase">Pendente</span>
                          )}
                        </td>
                        <td className="p-6 text-center">{p.stats?.photos || 0}</td>
                        <td className="p-6 text-center font-bold">R$ {(p.stats?.totalEarnings || 0).toFixed(2)}</td>
                        <td className="p-6 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-4 h-4 text-brutal-accent" />
                            {p.stats?.rating || 5.0}
                          </div>
                        </td>
                        <td className="p-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!p.verified && (
                              <button 
                                onClick={() => handleVerifyPhotographer(p.id)}
                                className="bg-green-500 text-white px-3 py-1 brutal-border-thin text-[9px] font-bold uppercase hover:bg-green-600 transition-colors cursor-pointer"
                              >
                                Aprovar
                              </button>
                            )}
                            <div className="relative" data-photographer-menu>
                              <button
                                type="button"
                                onClick={() => setOpenMenuPhotographerId((current) => (current === p.id ? null : p.id))}
                                className="p-2 hover:bg-gray-200 rounded transition-colors cursor-pointer"
                                aria-label="Opcoes do fotografo"
                              >
                                <MoreVertical className="w-5 h-5" />
                              </button>

                              <AnimatePresence>
                                {openMenuPhotographerId === p.id && (
                                  <motion.div
                                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                    className="absolute right-0 mt-2 w-56 bg-white brutal-border shadow-[6px_6px_0px_#000] z-[200] overflow-hidden"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openEditPhotographer(p)}
                                      className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest hover:bg-gray-50 cursor-pointer"
                                    >
                                      Editar
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isUpdatingPhotographer}
                                      onClick={() => handleDisablePhotographer(p)}
                                      className="w-full px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-red-600 hover:bg-red-50 disabled:text-gray-400 cursor-pointer"
                                    >
                                      Excluir / Desativar
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'sales' && (
            <motion.div
              key="sales"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <div className="md:col-span-2 bg-white p-8 brutal-border space-y-6">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h3 className="font-display text-2xl uppercase">Saques Pendentes</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mt-1">
                      Transferencias Pix solicitadas pelos fotografos
                    </p>
                  </div>
                  <div className="bg-brutal-black text-white brutal-border px-4 py-3">
                    <p className="font-mono text-[9px] uppercase text-gray-400">Total pendente</p>
                    <p className="font-display text-2xl text-brutal-accent">
                      {formatCurrency(pendingWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.amount || 0), 0))}
                    </p>
                  </div>
                </div>

                {pendingWithdrawals.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {pendingWithdrawals.map((withdrawal) => {
                      const photographer = photographerById.get(withdrawal.photographerId);
                      return (
                        <div key={withdrawal.id} className="p-4 bg-gray-50 brutal-border-thin space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="font-display text-lg uppercase truncate">{photographer?.name ?? 'Fotografo'}</p>
                              <p className="font-mono text-[10px] text-gray-400 truncate">{photographer?.email ?? withdrawal.photographerId}</p>
                              <p className="font-mono text-[10px] text-gray-500 uppercase mt-2">
                                Solicitado em {new Date(withdrawal.createdAt).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-display text-2xl text-brutal-accent">{formatCurrency(Number(withdrawal.amount))}</p>
                              <p className="font-mono text-[9px] text-yellow-700 uppercase">Pendente</p>
                            </div>
                          </div>

                          <div className="bg-white brutal-border-thin p-3">
                            <p className="font-mono text-[9px] uppercase text-gray-400">Chave Pix</p>
                            <p className="font-mono text-xs break-all">{withdrawal.pixKey}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              disabled={updatingWithdrawalId === withdrawal.id}
                              onClick={() => handleWithdrawalStatus(withdrawal, 'paid')}
                              className="h-10 bg-green-600 text-white brutal-border-thin font-mono text-[10px] uppercase font-bold hover:bg-green-700 disabled:bg-gray-400 transition-colors cursor-pointer"
                            >
                              {updatingWithdrawalId === withdrawal.id ? 'Salvando...' : 'Marcar Pago'}
                            </button>
                            <button
                              disabled={updatingWithdrawalId === withdrawal.id}
                              onClick={() => handleWithdrawalStatus(withdrawal, 'rejected')}
                              className="h-10 bg-white text-red-600 brutal-border-thin font-mono text-[10px] uppercase font-bold hover:bg-red-50 disabled:text-gray-400 transition-colors cursor-pointer"
                            >
                              Recusar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 bg-gray-50 brutal-border-thin text-center">
                    <p className="font-mono text-[10px] text-gray-400 uppercase">Nenhum saque pendente.</p>
                  </div>
                )}
              </div>

              <div className="bg-white p-8 brutal-border space-y-6">
                <h3 className="font-display text-2xl uppercase">Pagamentos Pendentes</h3>
                <div className="space-y-4">
                  {pendingOrders.length > 0 ? pendingOrders.map((order) => (
                    <div key={order.id} className="p-4 bg-gray-50 brutal-border-thin space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-display text-sm uppercase truncate">Pedido #{order.id.slice(0, 8)}</p>
                          <p className="font-mono text-[9px] text-gray-400 uppercase truncate">{order.buyerName} - {order.buyerEmail}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-lg">R$ {Number(order.total).toFixed(2)}</p>
                          <p className="font-mono text-[9px] text-yellow-700 uppercase">Pendente</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          disabled={updatingOrderId === order.id}
                          onClick={() => handleManualOrderStatus(order, 'paid')}
                          className="h-10 bg-green-600 text-white brutal-border-thin font-mono text-[10px] uppercase font-bold hover:bg-green-700 disabled:bg-gray-400 transition-colors cursor-pointer"
                        >
                          {updatingOrderId === order.id ? 'Salvando...' : 'Confirmar Pago'}
                        </button>
                        <button
                          disabled={updatingOrderId === order.id}
                          onClick={() => handleManualOrderStatus(order, 'cancelled')}
                          className="h-10 bg-white text-red-600 brutal-border-thin font-mono text-[10px] uppercase font-bold hover:bg-red-50 disabled:text-gray-400 transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                      <div className="border-t border-gray-200 pt-3 space-y-2">
                        <p className="font-mono text-[9px] text-gray-400 uppercase">{order.items?.length ?? 0} itens no pedido</p>
                        {(order.items ?? []).slice(0, 3).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                            <span className="truncate">{item.name}</span>
                            <span className="shrink-0 font-bold">R$ {Number(item.price).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )) : (
                    <div className="p-6 bg-gray-50 brutal-border-thin text-center">
                      <p className="font-mono text-[10px] text-gray-400 uppercase">Nenhum pagamento pendente.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-brutal-black text-white p-8 brutal-border space-y-6">
                <h3 className="font-display text-2xl uppercase text-brutal-accent">Log de Pedidos</h3>
                <div className="space-y-6">
                  {recentOrders.length > 0 ? recentOrders.map((order) => (
                    <div key={order.id} className="flex justify-between items-center text-xs font-mono border-b border-white/5 pb-4 last:border-0 last:pb-0">
                      <div className="flex gap-4">
                        <span className="text-gray-500">#{order.id.slice(0, 8)}</span>
                        <div className="min-w-0">
                          <p className="uppercase truncate max-w-[180px]">{order.buyerName}</p>
                          <p className="text-gray-500 text-[10px]">{order.paymentProvider} - {order.status}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={order.status === 'paid' ? 'text-green-500' : 'text-yellow-500'}>R$ {Number(order.total).toFixed(2)}</p>
                        <p className="text-gray-600 text-[9px]">
                          {new Date(order.createdAt).toLocaleDateString('pt-BR')} - {order.items?.length ?? 0} itens
                        </p>
                      </div>
                    </div>
                  )) : (
                    <div className="text-xs font-mono text-gray-500 uppercase">Nenhuma transacao registrada.</div>
                  )}
                </div>
                <div className="border-t border-white/10 pt-6 space-y-4">
                  <h4 className="font-display text-lg uppercase text-white">Historico de Saques</h4>
                  {processedWithdrawals.length > 0 ? processedWithdrawals.slice(0, 6).map((withdrawal) => {
                    const photographer = photographerById.get(withdrawal.photographerId);
                    return (
                      <div key={withdrawal.id} className="flex justify-between items-center text-xs font-mono border-b border-white/5 pb-3 last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="uppercase truncate max-w-[180px]">{photographer?.name ?? 'Fotografo'}</p>
                          <p className="text-gray-500 text-[10px]">{withdrawal.status} - {new Date(withdrawal.createdAt).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <p className={withdrawal.status === 'paid' ? 'text-green-500' : 'text-red-400'}>
                          {formatCurrency(Number(withdrawal.amount))}
                        </p>
                      </div>
                    );
                  }) : (
                    <div className="text-xs font-mono text-gray-500 uppercase">Nenhum saque processado.</div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl bg-white p-12 brutal-border space-y-12"
            >
              <div className="space-y-6">
                <h3 className="font-display text-3xl uppercase tracking-tighter">Taxas do Marketplace</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Platform Fee (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={settingsForm.platformFeePercent}
                      onChange={(event) => setSettingsForm((current) => ({
                        ...current,
                        platformFeePercent: Number(event.target.value),
                      }))}
                      className="w-full h-14 px-4 bg-gray-50 brutal-border font-display text-2xl focus:bg-white transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Taxa de Saque (R$)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settingsForm.withdrawalFee}
                      onChange={(event) => setSettingsForm((current) => ({
                        ...current,
                        withdrawalFee: Number(event.target.value),
                      }))}
                      className="w-full h-14 px-4 bg-gray-50 brutal-border font-display text-2xl focus:bg-white transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-8 border-t-2 border-gray-100">
                <h3 className="font-display text-3xl uppercase tracking-tighter">Segurança</h3>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-gray-50 brutal-border-thin">
                    <div className="flex items-center gap-3">
                      <Clock className="w-6 h-6 text-gray-400" />
                      <div>
                        <p className="font-display text-sm">AUTO-BLOCK SUSPICIOUS</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">Bloqueio automático após 3 falhas</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettingsForm((current) => ({
                        ...current,
                        autoBlockSuspicious: !current.autoBlockSuspicious,
                      }))}
                      className={`w-12 h-6 relative cursor-pointer brutal-border-thin transition-colors ${
                        settingsForm.autoBlockSuspicious ? 'bg-brutal-black' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-brutal-accent transition-all ${
                        settingsForm.autoBlockSuspicious ? 'right-1' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  <button
                    disabled={isSavingSettings}
                    onClick={handleSaveSettings}
                    className="w-full py-4 bg-brutal-black text-white font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors brutal-border cursor-pointer disabled:bg-gray-400"
                  >
                    Salvar Alterações Globais
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Photographer Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-brutal-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-brutal-white brutal-border brutal-shadow-heavy p-8 md:p-12"
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-6 right-6 p-2 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="mb-8">
                <h3 className="font-display text-4xl uppercase tracking-tighter mb-2">Novo Membro</h3>
                <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">Credenciamento de Fotógrafo</p>
              </div>

              <form onSubmit={handleAddPhotographer} className="space-y-6">
                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome Completo</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      required
                      type="text" 
                      value={newPhotographer.name}
                      onChange={e => setNewPhotographer({...newPhotographer, name: e.target.value})}
                      className="w-full h-14 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Email de Acesso</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      required
                      type="email" 
                      value={newPhotographer.email}
                      onChange={e => setNewPhotographer({...newPhotographer, email: e.target.value})}
                      className="w-full h-14 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                   <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Bio / Especialidade</label>
                   <textarea 
                     value={newPhotographer.bio}
                     onChange={e => setNewPhotographer({...newPhotographer, bio: e.target.value})}
                     className="w-full h-32 p-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none resize-none"
                   />
                </div>

                <button 
                  type="submit"
                  className="w-full h-16 bg-brutal-black text-white brutal-border font-display text-xl uppercase tracking-widest hover:bg-brutal-accent transition-all cursor-pointer"
                >
                  Concluir Cadastro
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Photographer Modal */}
      <AnimatePresence>
        {editingPhotographer && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingPhotographer(null)}
              className="absolute inset-0 bg-brutal-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-brutal-white brutal-border brutal-shadow-heavy p-8 md:p-12"
            >
              <button
                type="button"
                onClick={() => setEditingPhotographer(null)}
                className="absolute top-6 right-6 p-2 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="mb-8">
                <h3 className="font-display text-4xl uppercase tracking-tighter mb-2">Editar Fotografo</h3>
                <p className="font-mono text-xs text-gray-500 uppercase tracking-widest">{editingPhotographer.email}</p>
              </div>

              <form onSubmit={handleSavePhotographer} className="space-y-6">
                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Nome</label>
                  <input
                    required
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
                    className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">CPF</label>
                  <input
                    type="text"
                    value={editForm.cpf}
                    onChange={(e) => setEditForm((current) => ({ ...current, cpf: formatCpf(e.target.value) }))}
                    className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                    placeholder="000.000.000-00"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Telefone</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm((current) => ({ ...current, phone: e.target.value }))}
                    className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Avatar URL</label>
                  <input
                    type="url"
                    value={editForm.avatar}
                    onChange={(e) => setEditForm((current) => ({ ...current, avatar: e.target.value }))}
                    className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none"
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-400 tracking-widest">Bio</label>
                  <textarea
                    value={editForm.bio}
                    onChange={(e) => setEditForm((current) => ({ ...current, bio: e.target.value }))}
                    className="w-full h-28 p-4 bg-white brutal-border font-mono text-sm focus:ring-2 focus:ring-brutal-accent outline-none resize-none"
                  />
                </div>

                <button
                  disabled={isUpdatingPhotographer}
                  type="submit"
                  className="w-full h-16 bg-brutal-black text-white brutal-border font-display text-xl uppercase tracking-widest hover:bg-brutal-accent transition-all cursor-pointer disabled:bg-gray-400"
                >
                  {isUpdatingPhotographer ? 'Salvando...' : 'Salvar'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminSidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-4 font-mono text-xs uppercase tracking-widest transition-all cursor-pointer ${
        active 
          ? 'bg-brutal-accent/80 text-white border border-brutal-accent shadow-[0_0_24px_rgba(255,78,0,0.22)]' 
          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
      }`}
    >
      <span className={active ? 'text-white' : 'text-gray-500'}>
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-5 h-5' })}
      </span>
      {label}
    </button>
  );
}

function ReportCard({ title, emptyLabel, rows }: { title: string; emptyLabel: string; rows: Array<{ id: string; title: string; subtitle: string; value: string }> }) {
  return (
    <div className="bg-[#0d131c] p-6 border border-white/10">
      <h3 className="font-sans font-black text-base uppercase mb-6 text-white">{title}</h3>
      {rows.length > 0 ? (
        <div className="space-y-4">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 last:border-0 last:pb-0">
              <div className="flex items-center gap-4 min-w-0">
                <span className="w-8 h-8 bg-white/5 text-white border border-white/10 flex items-center justify-center font-display text-sm">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-sans font-bold text-sm uppercase truncate text-white">{row.title}</p>
                  <p className="font-mono text-[10px] text-gray-400 uppercase">{row.subtitle}</p>
                </div>
              </div>
              <p className="font-display text-xl text-brutal-accent shrink-0">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 bg-white/5 border border-white/10 text-center">
          <p className="font-mono text-[10px] text-gray-400 uppercase">{emptyLabel}</p>
        </div>
      )}
    </div>
  );
}

function AdminStatCard({ label, value, icon, sub, accent = false }: { label: string, value: string | number, icon: React.ReactNode, sub: string, accent?: boolean }) {
  return (
    <div className={`p-5 border border-white/10 bg-gradient-to-br from-[#121923] to-[#0d131c] transition-all hover:-translate-y-1 hover:border-white/20 ${
      accent ? 'text-white' : 'text-white'
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div className={`p-3 rounded-md ${accent ? 'bg-brutal-accent' : 'bg-white/10'}`}>
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-6 h-6 text-white' })}
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-green-400">↗ 8,3%</span>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2 text-gray-400">{label}</p>
      <p className="font-sans font-black text-3xl tracking-normal text-white">{value}</p>
      <p className="font-mono text-[10px] mt-4 uppercase leading-relaxed text-gray-400">{sub}</p>
      <div className="mt-6 flex items-end gap-1 h-9 opacity-80">
        {[18, 24, 16, 28, 36, 24, 34, 20, 26, 38, 32, 42].map((height, index) => (
          <span
            key={index}
            className={`flex-1 ${accent ? 'bg-brutal-accent' : 'bg-blue-500'}`}
            style={{ height }}
          />
        ))}
      </div>
    </div>
  );
}
