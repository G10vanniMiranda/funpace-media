import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Image as ImageIcon, 
  DollarSign, 
  Settings, 
  LogOut, 
  Upload, 
  Plus, 
  TrendingUp, 
  Users, 
  ChevronRight,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Tag,
  Star,
  Video as VideoIcon,
  Trash2,
  X
} from 'lucide-react';
import { Product, Photographer, PhotographerDashboardMetrics, PhotographerProductPerformance, PhotographerSale, WithdrawalRequest } from '../types';
import { photographerDashboardService, productService, withdrawalService } from '../lib/services';

interface PhotographerDashboardProps {
  photographer: Photographer;
  onLogout: () => void;
}

type UploadItem = {
  file: File;
  price: number;
  name: string;
  description: string;
  bib: string;
  previewUrl: string;
};

type ProductEditForm = {
  name: string;
  price: string;
  event: string;
  checkpoint: string;
  bib: string;
  status: NonNullable<Product['status']>;
};

type ProductTypeFilter = 'all' | Product['type'];
type ProductStatusFilter = 'all' | NonNullable<Product['status']>;

const withdrawalStatusLabels: Record<WithdrawalRequest['status'], string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  paid: 'Pago',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

function getInitialDashboardMetrics(photographer: Photographer): PhotographerDashboardMetrics {
  return {
    totalEarnings: Number(photographer.stats.totalEarnings) || 0,
    pendingEarnings: Number(photographer.stats.pendingEarnings) || 0,
    salesCount: Number(photographer.stats.salesCount) || 0,
    todaySalesCount: 0,
    publishedMediaCount: Number(photographer.stats.photos) || 0,
    photoCount: Number(photographer.stats.photos) || 0,
    videoCount: 0,
    rating: Number(photographer.stats.rating) || 5,
    downloads: Number(photographer.stats.salesCount) || 0,
    platformFeePercent: 30,
    monthlyEarnings: 0,
    availableBalance: Number(photographer.stats.pendingEarnings) || 0,
    monthlyGoal: 5000,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatSaleDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function generateVideoThumbnail(file: File): Promise<File | null> {
  if (!file.type.startsWith('video')) return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.onloadedmetadata = () => {
      const targetTime = Math.min(1, Math.max(0, (video.duration || 1) / 4));
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const context = canvas.getContext('2d');

      if (!context) {
        cleanup();
        resolve(null);
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        cleanup();

        if (!blob) {
          resolve(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'video';
        resolve(new File([blob], `${thumbnailName}-thumb.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.82);
    };
  });
}

async function generateImageThumbnail(file: File): Promise<File | null> {
  if (!file.type.startsWith('image')) return null;

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const maxSide = 1000;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const thumbnailName = file.name.replace(/\.[^.]+$/, '') || 'foto';
        resolve(new File([blob], `${thumbnailName}-preview.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.78);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

async function generateMediaThumbnail(file: File): Promise<File | null> {
  return file.type.startsWith('image')
    ? generateImageThumbnail(file)
    : generateVideoThumbnail(file);
}

export function PhotographerDashboard({ photographer, onLogout }: PhotographerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'products' | 'earnings'>('overview');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<PhotographerDashboardMetrics>(() => getInitialDashboardMetrics(photographer));
  const [recentSales, setRecentSales] = useState<PhotographerSale[]>([]);
  const [productPerformance, setProductPerformance] = useState<PhotographerProductPerformance[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalPixKey, setWithdrawalPixKey] = useState(photographer.cpf ?? '');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<UploadItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [eventInput, setEventInput] = useState('Geral');
  const [checkpointInput, setCheckpointInput] = useState('Ponto Principal');
  const [productSearch, setProductSearch] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<ProductTypeFilter>('all');
  const [productStatusFilter, setProductStatusFilter] = useState<ProductStatusFilter>('all');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<ProductEditForm>({
    name: '',
    price: '',
    event: '',
    checkpoint: '',
    bib: '',
    status: 'published',
  });
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const currentPreview = selectedFiles[previewIndex];
  const filteredProducts = React.useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();

    return products.filter((product) => {
      const productStatus = product.status ?? 'published';
      if (productStatus === 'removed') return false;

      const matchesSearch = !normalizedSearch || [
        product.name,
        product.event,
        product.checkpoint,
        product.bib,
        product.id,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      const matchesType = productTypeFilter === 'all' || product.type === productTypeFilter;
      const matchesStatus = productStatusFilter === 'all' || productStatus === productStatusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [products, productSearch, productTypeFilter, productStatusFilter]);

  React.useEffect(() => {
    async function loadPhotographerContent() {
      setIsLoading(true);
      try {
        const pProducts = await productService.getVendedorProducts(photographer.id);
        const visibleProducts = pProducts.filter((product) => (product.status ?? 'published') !== 'removed');
        setProducts(visibleProducts);
        const dashboard = await photographerDashboardService.getDashboard(photographer.id, visibleProducts);
        const pWithdrawals = await withdrawalService.getPhotographerWithdrawals(photographer.id);
        setDashboardMetrics(dashboard.metrics);
        setRecentSales(dashboard.recentSales);
        setProductPerformance(dashboard.productPerformance);
        setWithdrawals(pWithdrawals);
      } catch (error) {
        console.error("Error loading photographer content:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadPhotographerContent();
  }, [photographer.id]);

  const handleWithdrawalRequest = async () => {
    const pixKey = withdrawalPixKey.trim();
    setWithdrawalError('');

    if (dashboardMetrics.availableBalance <= 0) {
      setWithdrawalError('Nao ha saldo disponivel para saque.');
      return;
    }

    if (pixKey.length < 3) {
      setWithdrawalError('Informe uma chave Pix valida.');
      return;
    }

    setIsRequestingWithdrawal(true);
    try {
      const created = await withdrawalService.createWithdrawalRequest(
        photographer.id,
        dashboardMetrics.availableBalance,
        pixKey,
      );
      setWithdrawals((current) => [created, ...current]);
      setDashboardMetrics((current) => ({
        ...current,
        availableBalance: Math.max(0, current.availableBalance - Number(created.amount || 0)),
      }));
      setShowWithdrawalModal(false);
      setWithdrawalPixKey(photographer.cpf ?? '');
    } catch (error: any) {
      console.error('Erro ao solicitar saque:', error);
      setWithdrawalError(error?.message || 'Nao foi possivel solicitar o saque.');
    } finally {
      setIsRequestingWithdrawal(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        file,
        price: 19.90,
        name: file.name,
        description: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
        bib: '',
        previewUrl: URL.createObjectURL(file)
      }));
      setSelectedFiles((current) => {
        if (current.length === 0 && newFiles.length > 0) {
          setPreviewIndex(0);
        }
        return [...current, ...newFiles];
      });
      e.target.value = '';
    }
  };

  const clearSelectedFiles = () => {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelectedFiles([]);
    setPreviewIndex(0);
  };

  const updateSelectedFile = (index: number, changes: Partial<Pick<UploadItem, 'price' | 'description' | 'bib'>>) => {
    setSelectedFiles((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...changes } : item
    )));
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      price: String(product.price),
      event: product.event,
      checkpoint: product.checkpoint,
      bib: product.bib,
      status: product.status ?? 'published',
    });
  };

  const closeEditModal = () => {
    setEditingProduct(null);
    setEditForm({
      name: '',
      price: '',
      event: '',
      checkpoint: '',
      bib: '',
      status: 'published',
    });
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;

    const normalizedName = editForm.name.trim();
    const normalizedEvent = editForm.event.trim();
    const normalizedCheckpoint = editForm.checkpoint.trim();
    const normalizedBib = editForm.bib.trim();
    const normalizedPrice = Number(editForm.price);

    if (!normalizedName || !normalizedEvent || !normalizedCheckpoint) {
      alert('Preencha nome, evento e checkpoint.');
      return;
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      alert('Informe um preco valido.');
      return;
    }

    setIsLoading(true);
    try {
      const updatedProduct = await productService.updateProduct(editingProduct.id, {
        name: normalizedName,
        price: normalizedPrice,
        event: normalizedEvent,
        checkpoint: normalizedCheckpoint,
        bib: normalizedBib,
        status: editForm.status,
      });

      setProducts((current) => current.map((product) => (
        product.id === updatedProduct.id ? updatedProduct : product
      )));
      closeEditModal();
      alert('Produto atualizado com sucesso!');
    } catch (error) {
      console.error('Erro ao atualizar produto:', error);
      alert('Erro ao atualizar produto.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveProduct = async (product: Product) => {
    const shouldRemove = window.confirm('Remover este produto? Ele nao aparecera mais no painel nem na vitrine.');
    if (!shouldRemove) return;

    setIsLoading(true);
    try {
      await productService.removeProduct(product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      alert('Produto removido.');
    } catch (error) {
      console.error('Erro ao remover produto:', error);
      alert('Erro ao remover produto.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    const normalizedEvent = eventInput.trim();
    const normalizedCheckpoint = checkpointInput.trim();

    if (selectedFiles.length === 0) {
      alert("Selecione ao menos um arquivo para publicar.");
      return;
    }

    if (!normalizedEvent || !normalizedCheckpoint) {
      alert("Preencha evento e checkpoint antes de publicar.");
      return;
    }

    const invalidFileIndex = selectedFiles.findIndex((item) => (
      !item.description.trim() ||
      !Number.isFinite(Number(item.price)) ||
      Number(item.price) <= 0
    ));

    if (invalidFileIndex >= 0) {
      setPreviewIndex(invalidFileIndex);
      alert(`Preencha descricao e preco valido para o arquivo ${invalidFileIndex + 1}.`);
      return;
    }

    setIsLoading(true);
    try {
      for (const item of selectedFiles) {
        try {
          const uploadedFile = await productService.uploadProductFile(photographer.id, item.file);
          const thumbnailFile = await generateMediaThumbnail(item.file);
          const uploadedThumbnail = thumbnailFile
            ? await productService.uploadProductThumbnail(photographer.id, thumbnailFile)
            : null;

          await productService.addProduct({
            name: item.description.trim(),
            price: Number(item.price),
            url: uploadedFile.path,
            type: item.file.type.startsWith('image') ? 'IMG' : 'VIDEO',
            vendedorId: photographer.id,
            event: normalizedEvent,
            checkpoint: normalizedCheckpoint,
            bib: item.bib.trim(),
            thumbnailUrl: uploadedThumbnail?.path,
            storagePath: uploadedFile.path,
            status: 'published'
          });
        } catch (fileError) {
          const message = fileError instanceof Error ? fileError.message : String(fileError);
          throw new Error(`Falha ao publicar "${item.name}": ${message}`);
        }
      }
      
      const updatedProducts = await productService.getVendedorProducts(photographer.id);
      const visibleProducts = updatedProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      setProducts(visibleProducts);
      const dashboard = await photographerDashboardService.getDashboard(photographer.id, visibleProducts);
      setDashboardMetrics(dashboard.metrics);
      setRecentSales(dashboard.recentSales);
      setProductPerformance(dashboard.productPerformance);
      clearSelectedFiles();
      setPreviewIndex(0);
      setShowUploadModal(false);
      alert("Upload realizado com sucesso!");
    } catch (error) {
      console.error("Erro no upload:", error);
      alert(error instanceof Error ? error.message : "Erro ao realizar upload.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brutal-white flex flex-col items-center justify-center p-6">
        <Loader2 className="w-12 h-12 text-brutal-accent animate-spin mb-4" />
        <p className="font-mono text-sm uppercase tracking-widest text-gray-500 animate-pulse">Carregando painel...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-brutal-white font-sans text-brutal-black overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-brutal-black text-white border-b-2 border-brutal-black">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 brutal-border overflow-hidden bg-white">
            <img src={photographer.avatar} alt="Me" className="w-full h-full object-cover" />
          </div>
          <span className="font-display text-lg tracking-tighter">STUDIO DASH</span>
        </div>
        <button onClick={onLogout} className="p-2">
          <LogOut className="w-5 h-5 text-brutal-accent" />
        </button>
      </div>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-brutal-black text-white border-r-4 border-brutal-black">
        <div className="p-8 border-b-2 border-white/10">
          <h1 className="font-display text-3xl tracking-tighter mb-1">STUDIO</h1>
          <p className="font-mono text-[10px] text-brutal-accent uppercase tracking-[0.3em]">Photographer Hub</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <SidebarLink 
            icon={<LayoutDashboard />} 
            label="Overview" 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')} 
          />
          <SidebarLink 
            icon={<ImageIcon />} 
            label="Meus Produtos" 
            active={activeTab === 'products'} 
            onClick={() => setActiveTab('products')} 
          />
          <SidebarLink 
            icon={<DollarSign />} 
            label="Ganhos" 
            active={activeTab === 'earnings'} 
            onClick={() => setActiveTab('earnings')} 
          />
        </nav>

        <div className="p-4 mt-auto">
          <div className="bg-white/5 p-4 brutal-border-thin mb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 brutal-border overflow-hidden bg-white">
                <img src={photographer.avatar} alt="Me" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm truncate">{photographer.name}</p>
                <p className="font-mono text-[10px] text-gray-400 truncate tracking-tight">{photographer.email}</p>
              </div>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-3 font-mono text-[10px] uppercase font-bold text-gray-400 hover:text-brutal-accent transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sair do Painel
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-12">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h2 className="font-display text-5xl md:text-7xl tracking-tighter uppercase">
              {activeTab === 'overview' && 'Dashboard'}
              {activeTab === 'products' && 'Produtos'}
              {activeTab === 'earnings' && 'Estatísticas'}
            </h2>
            <p className="font-mono text-gray-500 mt-2">Bem-vindo de volta, {photographer.name.split(' ')[0]}!</p>
          </div>

          <button 
            onClick={() => setShowUploadModal(true)}
            className="bg-brutal-accent text-white px-8 py-4 brutal-border brutal-shadow-hover flex items-center gap-3 font-display text-lg uppercase tracking-widest hover:-translate-x-1 hover:-translate-y-1 transition-all cursor-pointer"
          >
            <Plus className="w-6 h-6" />
            Nova Captura
          </button>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              {/* Quick Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard 
                  label="Ganhos Totais" 
                  value={formatCurrency(dashboardMetrics.totalEarnings)} 
                  icon={<DollarSign />} 
                  trend={`${dashboardMetrics.platformFeePercent}% taxa plataforma`}
                  accent 
                />
                <StatCard 
                  label="Vendas Realizadas" 
                  value={dashboardMetrics.salesCount} 
                  icon={<TrendingUp />} 
                  trend={`+${dashboardMetrics.todaySalesCount} hoje`}
                />
                <StatCard 
                  label="Fotos No Ar" 
                  value={dashboardMetrics.publishedMediaCount} 
                  icon={<ImageIcon />} 
                  trend={`${dashboardMetrics.photoCount} fotos / ${dashboardMetrics.videoCount} videos`}
                />
                <StatCard 
                  label="Aguardando Resgate" 
                  value={formatCurrency(dashboardMetrics.pendingEarnings)} 
                  icon={<AlertCircle />} 
                  trend="Liberação em 7 dias"
                  warning
                />
              </div>

              {/* Main Grid: Recent Sales & Top Photos */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-display text-2xl uppercase">Vendas Recentes</h3>
                    <button
                      onClick={() => setActiveTab('earnings')}
                      className="font-mono text-[10px] uppercase text-gray-400 hover:text-brutal-black cursor-pointer"
                    >
                      Ver todas
                    </button>
                  </div>
                  <div className="space-y-4">
                    {recentSales.length === 0 ? (
                      <div className="bg-white p-8 brutal-border text-center">
                        <p className="font-display text-xl uppercase">Nenhuma venda paga ainda</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest mt-2">
                          As vendas aparecem aqui quando o pagamento for confirmado.
                        </p>
                      </div>
                    ) : recentSales.map((sale) => (
                      <div key={sale.id} className="bg-white p-4 brutal-border flex items-center gap-4 group hover:bg-gray-50 transition-colors">
                        <div className="w-16 h-16 brutal-border bg-gray-100 overflow-hidden">
                          <img src={sale.thumbnailUrl || sale.url} alt={sale.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1">
                          <p className="font-display text-lg">{sale.name}</p>
                          <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest leading-none">
                            ID {sale.orderId.substring(0, 8)} - {sale.event}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-xl text-green-600">+ {formatCurrency(sale.netAmount)}</p>
                          <p className="font-mono text-[10px] text-gray-400 uppercase">{formatSaleDate(sale.orderCreatedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <h3 className="font-display text-2xl uppercase">Top Performance</h3>
                  <div className="bg-brutal-black text-white p-8 brutal-border brutal-shadow">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="bg-brutal-accent p-3 brutal-border-thin">
                        <Star className="w-6 h-6 fill-current" />
                      </div>
                      <div>
                        <p className="font-display text-2xl">AVALIAÇÃO</p>
                        <p className="font-mono text-sm text-gray-400">Pela comunidade</p>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <span className="font-mono text-xs uppercase text-gray-400">Score Geral</span>
                        <span className="font-display text-4xl text-brutal-accent">{dashboardMetrics.rating}</span>
                      </div>
                      <div className="flex justify-between items-end border-b border-white/10 pb-4">
                        <span className="font-mono text-xs uppercase text-gray-400">Downloads</span>
                        <span className="font-display text-4xl">{dashboardMetrics.downloads}</span>
                      </div>
                      <button
                        onClick={() => setActiveTab('earnings')}
                        className="w-full py-4 mt-4 bg-white text-brutal-black font-display text-sm uppercase tracking-widest hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer"
                      >
                        Ver Relatório
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'products' && (
            <motion.div
              key="products"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="flex flex-col md:flex-row gap-6 mb-8">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input 
                    type="text" 
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="BUSCAR POR NOME, EVENTO, CHECKPOINT OU PEITO..." 
                    className="w-full h-14 pl-12 pr-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 md:flex gap-3">
                  <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <select
                      value={productTypeFilter}
                      onChange={(event) => setProductTypeFilter(event.target.value as ProductTypeFilter)}
                      className="w-full md:w-40 h-14 pl-10 pr-4 bg-white brutal-border font-mono text-xs uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    >
                      <option value="all">Todos tipos</option>
                      <option value="IMG">Fotos</option>
                      <option value="VIDEO">Videos</option>
                      <option value="VIEW">Views</option>
                    </select>
                  </div>
                  <select
                    value={productStatusFilter}
                    onChange={(event) => setProductStatusFilter(event.target.value as ProductStatusFilter)}
                    className="w-full md:w-40 h-14 px-4 bg-white brutal-border font-mono text-xs uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                  >
                    <option value="all">Ativos</option>
                    <option value="published">Publicado</option>
                    <option value="draft">Rascunho</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
                <p className="font-mono text-[10px] uppercase text-gray-500">
                  {filteredProducts.length} de {products.length} produtos encontrados
                </p>
                {(productSearch || productTypeFilter !== 'all' || productStatusFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setProductSearch('');
                      setProductTypeFilter('all');
                      setProductStatusFilter('all');
                    }}
                    className="self-start md:self-auto font-mono text-[10px] uppercase font-bold text-brutal-accent hover:underline cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-8">
                {filteredProducts.map((product) => (
                  <div key={product.id} className="group bg-white brutal-border brutal-shadow-hover overflow-hidden transition-all">
                    <div className="aspect-[3/4] relative">
                      {product.type === 'IMG' ? (
                        <img src={product.thumbnailUrl || product.url} alt={product.name} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                      ) : product.thumbnailUrl ? (
                        <img src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                      ) : (
                        <video src={product.url} poster={product.thumbnailUrl} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" muted preload="metadata" />
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        <span className="bg-brutal-black text-white px-2 py-0.5 font-mono text-[8px] uppercase tracking-tighter">
                          {product.type}
                        </span>
                        <span className="bg-brutal-accent text-white px-2 py-0.5 font-mono text-[8px] uppercase tracking-tighter">
                          R$ {product.price.toFixed(2)}
                        </span>
                        {(product.status ?? 'published') !== 'published' && (
                          <span className="bg-white text-brutal-black px-2 py-0.5 font-mono text-[8px] uppercase tracking-tighter">
                            {product.status}
                          </span>
                        )}
                      </div>
                      <div className="absolute inset-0 bg-brutal-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all">
                        <p className="text-white font-mono text-[10px] uppercase mb-4 text-center px-4">{product.name}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditModal(product)}
                            className="bg-white p-2 brutal-border-thin hover:bg-brutal-accent hover:text-white transition-colors cursor-pointer"
                            title="Editar produto"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemoveProduct(product)}
                            className="bg-white p-2 brutal-border-thin hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                            title="Remover produto"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {filteredProducts.length === 0 && (
                <div className="bg-white brutal-border p-10 text-center mt-8">
                  <Search className="w-10 h-10 text-gray-300 mx-auto mb-4" />
                  <h3 className="font-display text-2xl uppercase mb-2">Nenhum produto encontrado</h3>
                  <p className="font-mono text-xs uppercase text-gray-500">Ajuste os filtros ou limpe a busca para ver todo o catalogo.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'earnings' && (
            <motion.div
              key="earnings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              <div className="bg-brutal-black text-white p-8 brutal-border brutal-shadow flex flex-col md:flex-row justify-between items-center gap-8">
                <div>
                  <h3 className="font-display text-2xl uppercase text-gray-400 mb-2">Seu Saldo Disponivel</h3>
                  <p className="font-display text-7xl md:text-9xl text-brutal-accent leading-none tracking-tighter">
                    {formatCurrency(dashboardMetrics.availableBalance)}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-4">
                    Vendas pagas liberadas, descontando saques pendentes e pagos.
                  </p>
                </div>
                <div className="w-full md:w-auto">
                  <button
                    disabled={dashboardMetrics.availableBalance <= 0}
                    onClick={() => setShowWithdrawalModal(true)}
                    className="w-full px-12 py-6 bg-white text-brutal-black font-display text-xl uppercase tracking-widest hover:bg-brutal-accent hover:text-white hover:-translate-x-1 hover:-translate-y-1 transition-all brutal-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-brutal-black disabled:hover:translate-x-0 disabled:hover:translate-y-0"
                  >
                    Solicitar Saque
                  </button>
                  <p className="font-mono text-center text-[10px] text-gray-500 mt-4 uppercase tracking-widest">Vendas recentes liberam apos 7 dias</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 brutal-border space-y-6">
                  <h3 className="font-display text-2xl uppercase">Historico Financeiro</h3>
                  {withdrawals.length > 0 && (
                    <div className="space-y-3">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">Solicitacoes de saque</p>
                      {withdrawals.slice(0, 4).map((withdrawal) => (
                        <div key={withdrawal.id} className="flex justify-between items-center gap-4 py-3 border-b border-gray-100">
                          <div className="min-w-0">
                            <p className="font-display text-lg truncate">Saque {withdrawalStatusLabels[withdrawal.status]}</p>
                            <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest truncate">
                              Pix: {withdrawal.pixKey} - {formatSaleDate(withdrawal.createdAt)}
                            </p>
                          </div>
                          <p className={`font-display text-xl shrink-0 ${
                            withdrawal.status === 'rejected' || withdrawal.status === 'cancelled' ? 'text-red-600' : 'text-brutal-accent'
                          }`}>
                            - {formatCurrency(Number(withdrawal.amount))}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {recentSales.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="font-display text-xl uppercase">Nenhuma venda paga ainda</p>
                      <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest mt-2">
                        As movimentacoes aparecem quando pagamentos forem confirmados.
                      </p>
                    </div>
                  ) : recentSales.map((sale) => (
                    <div key={sale.id} className="flex justify-between items-center gap-4 py-4 border-b border-gray-100">
                      <div className="min-w-0">
                        <p className="font-display text-lg truncate">Venda Confirmada</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">
                          Pedido #{sale.orderId.substring(0, 8)} - {sale.event}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display text-xl text-green-600">+ {formatCurrency(sale.netAmount)}</p>
                        <p className="font-mono text-[10px] text-gray-400 uppercase">{formatSaleDate(sale.orderCreatedAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white p-8 brutal-border flex flex-col items-center justify-center text-center">
                   <TrendingUp className="w-16 h-16 text-brutal-accent mb-6" />
                   <h3 className="font-display text-3xl uppercase mb-4">Meta Mensal</h3>
                   <div className="w-full h-4 bg-gray-100 brutal-border-thin mb-4 overflow-hidden">
                     <div
                       className="h-full bg-brutal-accent"
                       style={{ width: `${Math.min(100, Math.round((dashboardMetrics.monthlyEarnings / dashboardMetrics.monthlyGoal) * 100))}%` }}
                     />
                   </div>
                   <p className="font-mono text-sm text-gray-500">
                     Voce atingiu <span className="font-bold text-brutal-black">
                       {Math.min(100, Math.round((dashboardMetrics.monthlyEarnings / dashboardMetrics.monthlyGoal) * 100))}%
                     </span> da sua meta de <span className="font-bold text-brutal-black">{formatCurrency(dashboardMetrics.monthlyGoal)}</span>
                   </p>
                   <p className="font-mono text-[10px] uppercase text-gray-400 tracking-widest mt-3">
                     Receita do mes: {formatCurrency(dashboardMetrics.monthlyEarnings)}
                   </p>
                </div>
              </div>

              <div className="bg-white p-8 brutal-border space-y-6">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h3 className="font-display text-2xl uppercase">Performance por Produto</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mt-1">
                      Ranking por receita liquida, vendas pagas e downloads reais.
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase text-gray-400">{productPerformance.length} itens</span>
                </div>

                {productPerformance.length === 0 ? (
                  <div className="py-8 text-center bg-gray-50 brutal-border-thin">
                    <p className="font-display text-xl uppercase">Sem performance registrada</p>
                    <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest mt-2">
                      Produtos aparecem aqui depois das primeiras vendas pagas.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {productPerformance.map((item, index) => (
                      <div key={item.productId} className="grid grid-cols-[auto_56px_1fr_auto] items-center gap-4 p-3 bg-gray-50 brutal-border-thin">
                        <span className="font-display text-2xl text-brutal-accent w-8">#{index + 1}</span>
                        <div className="w-14 h-14 bg-gray-100 brutal-border-thin overflow-hidden">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-mono text-[9px] text-gray-400">{item.type}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-display text-lg truncate">{item.name}</p>
                          <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest truncate">
                            Peito {item.bib || 'N/I'} - {item.event}
                          </p>
                          <p className="font-mono text-[10px] text-gray-500 uppercase mt-1">
                            {item.salesCount} venda(s) - {item.downloads} download(s)
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-display text-xl text-green-600">{formatCurrency(item.netRevenue)}</p>
                          <p className="font-mono text-[9px] uppercase text-gray-400">liquido</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showWithdrawalModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWithdrawalModal(false)}
              className="absolute inset-0 bg-brutal-black/90 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 20 }}
              className="relative w-full max-w-xl bg-brutal-white brutal-border brutal-shadow-heavy p-8 space-y-6"
            >
              <button
                onClick={() => setShowWithdrawalModal(false)}
                className="absolute right-4 top-4 p-2 text-gray-400 hover:text-brutal-black transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2">Repasse financeiro</p>
                <h3 className="font-display text-4xl uppercase tracking-tighter">Solicitar Saque</h3>
                <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-3">
                  A solicitacao fica pendente para processamento manual pela equipe Funpace.
                </p>
              </div>

              <div className="bg-brutal-black text-white brutal-border p-5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400">Valor solicitado</p>
                <p className="font-display text-5xl text-brutal-accent mt-1">{formatCurrency(dashboardMetrics.availableBalance)}</p>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Chave Pix para recebimento</label>
                <input
                  type="text"
                  value={withdrawalPixKey}
                  onChange={(event) => setWithdrawalPixKey(event.target.value)}
                  placeholder="CPF, e-mail, telefone ou chave aleatoria"
                  className="w-full h-14 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                />
              </div>

              {withdrawalError && (
                <div className="bg-red-50 brutal-border-thin p-4 font-mono text-xs uppercase text-red-600">
                  {withdrawalError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleWithdrawalRequest}
                  disabled={isRequestingWithdrawal}
                  className="h-14 flex-1 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {isRequestingWithdrawal && <Loader2 className="w-5 h-5 animate-spin" />}
                  Confirmar Solicitação
                </button>
                <button
                  onClick={() => setShowWithdrawalModal(false)}
                  className="h-14 px-6 bg-white text-brutal-black brutal-border font-display text-sm uppercase tracking-widest hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Product Modal */}
      <AnimatePresence>
        {editingProduct && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEditModal}
              className="absolute inset-0 bg-brutal-black/90 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-3xl bg-brutal-white brutal-border brutal-shadow-heavy overflow-hidden max-h-[90vh]"
            >
              <div className="grid md:grid-cols-[280px_1fr]">
                <div className="bg-brutal-black p-6">
                  <div className="aspect-[3/4] bg-black brutal-border overflow-hidden">
                    {editingProduct.type === 'IMG' ? (
                      <img src={editingProduct.thumbnailUrl || editingProduct.url} alt={editingProduct.name} className="w-full h-full object-cover" />
                    ) : editingProduct.thumbnailUrl ? (
                      <img src={editingProduct.thumbnailUrl} alt={editingProduct.name} className="w-full h-full object-cover" />
                    ) : (
                      <video src={editingProduct.url} className="w-full h-full object-cover" muted preload="metadata" />
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="bg-white text-brutal-black px-2 py-1 font-mono text-[9px] uppercase">
                      {editingProduct.type}
                    </span>
                    <span className="text-brutal-accent font-display text-2xl">
                      R$ {Number(editingProduct.price).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="p-8 space-y-5">
                  <div>
                    <h3 className="font-display text-4xl tracking-tighter uppercase">Editar Produto</h3>
                    <p className="font-mono text-[10px] text-gray-400 uppercase mt-1">Atualize os dados da captura publicada.</p>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Preco</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.price}
                        onChange={(event) => setEditForm((current) => ({ ...current, price: event.target.value }))}
                        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Status</label>
                      <select
                        value={editForm.status}
                        onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as ProductEditForm['status'] }))}
                        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                      >
                        <option value="published">Publicado</option>
                        <option value="draft">Rascunho</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Evento / Colecao</label>
                    <input
                      type="text"
                      value={editForm.event}
                      onChange={(event) => setEditForm((current) => ({ ...current, event: event.target.value }))}
                      className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint</label>
                      <input
                        type="text"
                        value={editForm.checkpoint}
                        onChange={(event) => setEditForm((current) => ({ ...current, checkpoint: event.target.value }))}
                        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Numero de Peito</label>
                      <input
                        type="text"
                        value={editForm.bib}
                        onChange={(event) => setEditForm((current) => ({
                          ...current,
                          bib: event.target.value.replace(/[^\w-]/g, '').slice(0, 32),
                        }))}
                        className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-3 pt-3">
                    <button
                      disabled={isLoading}
                      onClick={handleUpdateProduct}
                      className="flex-1 py-4 bg-brutal-accent text-white font-display text-lg uppercase tracking-widest brutal-border brutal-shadow-hover hover:-translate-x-1 hover:-translate-y-1 transition-all cursor-pointer disabled:bg-gray-400"
                    >
                      {isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Salvar'}
                    </button>
                    <button
                      onClick={closeEditModal}
                      className="flex-1 py-4 bg-white text-brutal-black font-display text-lg uppercase tracking-widest brutal-border hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUploadModal(false)}
              className="absolute inset-0 bg-brutal-black/90 backdrop-blur-sm" 
            />
            
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-5xl bg-brutal-white brutal-border brutal-shadow-heavy flex flex-col md:flex-row overflow-hidden max-h-[90vh]"
            >
              <div className="md:w-1/2 p-8 md:p-12 border-b-2 md:border-b-0 md:border-r-2 border-brutal-black overflow-y-auto min-h-0">
                <h3 className="font-display text-4xl mb-4 tracking-tighter uppercase">Enviar Capturas</h3>
                <p className="font-mono text-[10px] text-gray-400 uppercase mb-8">Selecione múltiplas fotos ou vídeos para o seu catálogo.</p>
                
                <input 
                  type="file" 
                  multiple 
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,video/*"
                />

                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-video brutal-border border-dashed border-2 border-gray-300 flex flex-col items-center justify-center group hover:bg-gray-50 transition-colors cursor-pointer mb-8"
                >
                  <div className="bg-brutal-accent text-white p-4 brutal-border group-hover:scale-110 transition-transform mb-4">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="font-display text-lg uppercase mb-1">Escolher Arquivos</p>
                  <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">Suporta múltiplos uploads</p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-mono text-[10px] uppercase font-bold text-gray-500">Arquivos Selecionados ({selectedFiles.length})</h4>
                    <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                       {selectedFiles.map((item, idx) => (
                         <div
                           key={idx}
                           onClick={() => setPreviewIndex(idx)}
                           className={`w-full bg-white p-3 brutal-border-thin text-left transition-colors cursor-pointer ${
                             previewIndex === idx ? 'ring-2 ring-brutal-accent' : 'hover:bg-gray-50'
                           }`}
                         >
                           <div className="flex items-start gap-3">
                             <div className="w-14 h-14 bg-gray-100 brutal-border-thin overflow-hidden shrink-0">
                                {item.file.type.startsWith('image') ? (
                                  <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-brutal-black text-white">
                                    <VideoIcon className="w-4 h-4" />
                                  </div>
                                )}
                             </div>
                             <div className="flex-1 min-w-0 space-y-2">
                               <p className="font-mono text-[9px] uppercase truncate text-gray-400">{item.name}</p>
                               <input
                                type="text"
                                value={item.description}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateSelectedFile(idx, { description: event.target.value })}
                                placeholder="Descricao desta foto"
                                className="w-full h-9 px-2 brutal-border-thin font-mono text-[10px] uppercase"
                               />
                               <div className="grid grid-cols-[1fr_96px] gap-2">
                                 <input
                                  type="text"
                                  value={item.bib}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => updateSelectedFile(idx, { bib: event.target.value.replace(/[^\w-]/g, '').slice(0, 32) })}
                                  placeholder="N PEITO OPC."
                                  className="w-full h-9 px-2 brutal-border-thin font-mono text-[10px] uppercase"
                                 />
                                 <div className="flex items-center gap-1">
                                   <span className="font-mono text-[9px] uppercase text-gray-400">R$</span>
                                   <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.price}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => updateSelectedFile(idx, { price: parseFloat(event.target.value) })}
                                    className="w-full h-9 px-2 brutal-border-thin font-mono text-[10px] text-center"
                                   />
                                 </div>
                               </div>
                             </div>
                           </div>
                         </div>
                       ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="md:w-1/2 p-8 md:p-12 bg-gray-50 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                <div className="mb-6">
                  <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Preview antes de publicar</label>
                  <div className="aspect-video bg-brutal-black brutal-border overflow-hidden flex items-center justify-center">
                    {currentPreview ? (
                      currentPreview.file.type.startsWith('image') ? (
                        <img
                          src={currentPreview.previewUrl}
                          alt={currentPreview.name}
                          className="w-full h-full object-contain bg-brutal-black"
                        />
                      ) : (
                        <video
                          src={currentPreview.previewUrl}
                          className="w-full h-full bg-brutal-black"
                          controls
                          preload="metadata"
                        />
                      )
                    ) : (
                      <div className="text-center px-8">
                        <ImageIcon className="w-10 h-10 text-white/30 mx-auto mb-4" />
                        <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">Selecione uma imagem ou video para revisar</p>
                      </div>
                    )}
                  </div>
                  {currentPreview && (
                    <div className="mt-3 flex items-center justify-between gap-4">
                      <p className="font-mono text-[10px] uppercase truncate text-gray-500">{currentPreview.name}</p>
                      <span className="shrink-0 font-mono text-[10px] uppercase bg-white brutal-border-thin px-2 py-1">
                        {currentPreview.file.type.startsWith('image') ? 'IMG' : 'VIDEO'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="space-y-6 pb-6">
                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Nome do Evento / Coleção</label>
                    <input 
                      type="text" 
                      value={eventInput}
                      onChange={e => setEventInput(e.target.value)}
                      placeholder="EX: TREINO DE SÁBADO, MARATONA SP" 
                      className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase font-bold text-gray-500 mb-2">Checkpoint / Localização</label>
                    <input 
                      type="text" 
                      value={checkpointInput}
                      onChange={e => setCheckpointInput(e.target.value)}
                      placeholder="EX: KM 15, CHEGADA" 
                      className="w-full h-12 px-4 bg-white brutal-border font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brutal-accent"
                    />
                  </div>

                  <div className="bg-brutal-black text-white p-6 brutal-border">
                    <p className="font-mono text-[10px] uppercase text-gray-400 mb-1">Resumo do Lote</p>
                    <div className="flex justify-between items-end">
                      <span className="font-display text-lg uppercase">Total Estimado</span>
                      <span className="font-display text-3xl text-brutal-accent">
                        R$ {selectedFiles.reduce((acc, curr) => acc + curr.price, 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                </div>

                <div className="pt-6">
                  <button 
                    disabled={selectedFiles.length === 0 || isLoading}
                    onClick={handleUpload}
                    className="w-full py-6 bg-brutal-accent text-white font-display text-xl uppercase tracking-widest hover:-translate-x-1 hover:-translate-y-1 transition-all brutal-border brutal-shadow-hover cursor-pointer disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isLoading ? <Loader2 className="w-8 h-8 animate-spin mx-auto" /> : 'Publicar Produtos'}
                  </button>
                  <button 
                    onClick={() => {
                      clearSelectedFiles();
                      setShowUploadModal(false);
                    }}
                    className="w-full py-4 mt-4 font-mono text-[10px] uppercase font-bold text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 font-display text-sm uppercase tracking-wide transition-all cursor-pointer ${
        active 
          ? 'bg-brutal-accent text-white brutal-border-thin shadow-[4px_4px_0px_#000]' 
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <span className={active ? 'text-white' : 'text-gray-500'}>
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-5 h-5' })}
      </span>
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, trend, accent = false, warning = false }: { label: string, value: string | number, icon: React.ReactNode, trend: string, accent?: boolean, warning?: boolean }) {
  return (
    <div className={`p-6 brutal-border transition-all hover:-translate-y-1 hover:brutal-shadow ${
      accent ? 'bg-brutal-black text-white border-brutal-black' : 'bg-white'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 brutal-border-thin ${accent ? 'bg-brutal-accent border-white' : 'bg-gray-50'}`}>
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: `w-5 h-5 ${accent ? 'text-white' : 'text-brutal-black'}` })}
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-tighter ${warning ? 'text-red-500' : 'text-gray-500'}`}>{trend}</span>
      </div>
      <p className={`font-mono text-[10px] uppercase tracking-widest mb-1 ${accent ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
      <p className={`font-display text-4xl tracking-tighter ${accent ? 'text-brutal-accent' : ''}`}>{value}</p>
    </div>
  );
}
