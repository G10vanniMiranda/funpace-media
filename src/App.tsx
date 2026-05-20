import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PhotoGrid } from './components/PhotoGrid';
import { VideoGrid } from './components/VideoGrid';
import { CartDrawer } from './components/CartDrawer';
import { CustomerOrdersDrawer } from './components/CustomerOrdersDrawer';
import { Footer } from './components/Footer';
import { AuthView } from './components/AuthView';
import { PhotographerSection } from './components/PhotographerSection';
import { PhotographerProfile } from './components/PhotographerProfile';
import { PhotographerDashboard } from './components/PhotographerDashboard';
import { PhotographerLogin } from './components/PhotographerLogin';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLogin } from './components/AdminLogin';
import { Product, Photographer, Buyer, AdminMetrics, Order } from './types';
import { useAuth } from './contexts/AuthContext';
import { isMockMode } from './lib/config';
import { productService, photographerService, orderService } from './lib/services';
import { logout } from './lib/supabase';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Scan, ArrowLeft } from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DataErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: DataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  }
  console.error('Data Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Main Storefront Component
function Storefront() {
  const { user } = useAuth();
  const [cart, setCart] = useState<Product[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [searchBib, setSearchBib] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'photos' | 'videos'>('photos');
  const [isAnalyzingSelfie, setIsAnalyzingSelfie] = useState(false);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [searchType, setSearchType] = useState<'bib' | 'selfie' | null>(null);
  const [selectedPhotographerId, setSelectedPhotographerId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [loggedInPhotographer, setLoggedInPhotographer] = useState<Photographer | null>(null);
  const [photos, setPhotos] = useState<Product[]>([]);
  const [videos, setVideos] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const products = await productService.getLatestProducts();
        setPhotos(products.filter(p => p.type === 'IMG'));
        setVideos(products.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      alert("Pagamento confirmado! Suas fotos estarão disponíveis em breve no seu painel.");
      setCart([]);
      // Limpar URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('payment') === 'cancel') {
      alert("O pagamento foi cancelado. Você pode tentar novamente quando desejar.");
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const photographerOwnedPhotos = loggedInPhotographer
    ? photos.filter(p => p.vendedorId === loggedInPhotographer.id)
    : [];

  const photographerOwnedVideos = loggedInPhotographer
    ? videos.filter(v => v.vendedorId === loggedInPhotographer.id)
    : [];

  const handlePhotographerLogin = (photographer: Photographer) => {
    setLoggedInPhotographer(photographer);
  };

  const handleLogout = () => {
    setLoggedInPhotographer(null);
    setShowDashboard(false);
  };

  const displayPhotos = photos;
  const displayVideos = videos;

  const handleAddToCart = (item: Product) => {
    if (!cart.some(p => p.id === item.id)) {
      setCart([...cart, item]);
      setIsCartOpen(true);
    }
  };

  const handleRemoveFromCart = (id: string) => {
    setCart(cart.filter(p => p.id !== id));
  };

  const handleSearch = async (bib: string) => {
    setIsLoading(true);
    setSearchBib(bib);
    setSearchType('bib');
    setSelectedPhotographerId(null);
    setShowDashboard(false);

    try {
      const searchedProducts = await productService.searchByBib(bib);
      setPhotos(searchedProducts.filter(p => p.type === 'IMG'));
      setVideos(searchedProducts.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
    } catch (error) {
      handleDataError(error, OperationType.LIST, 'products');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelfieSearch = (file: File) => {
    setSelfieFile(file);
    setIsAnalyzingSelfie(true);

    setTimeout(() => {
      setIsAnalyzingSelfie(false);
      setSearchType('selfie');
      setSearchBib(null);
      setSelectedPhotographerId(null);
      setShowDashboard(false);
    }, 3000);
  };

  const clearSearch = async () => {
    setIsLoading(true);
    setSearchBib(null);
    setSearchType(null);
    setSelfieFile(null);
    setSelectedPhotographerId(null);

    try {
      const products = await productService.getLatestProducts();
      setPhotos(products.filter(p => p.type === 'IMG'));
      setVideos(products.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
    } catch (error) {
      console.error("Error clearing search:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (cpf: string) => {
    setIsLoading(true);
    try {
      if (!user?.email) {
        setIsAuthOpen(true);
        return;
      }

      const buyer: Buyer = {
        fullName: user.displayName || user.email,
        email: user.email,
        phone: 'nao_informado',
        cpf,
      };
      // 1. Criar sessão de pagamento no backend enviando os dados do comprador
      const response = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.uid,
          buyer,
          items: cart.map(item => ({ id: item.id })),
          successUrl: `${window.location.origin}?payment=success`,
          cancelUrl: `${window.location.origin}?payment=cancel`,
        }),
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Erro ao iniciar pagamento');
      }

    } catch (error: any) {
      console.error("Erro no checkout:", error);
      alert("Erro ao processar checkout: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenOrders = () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    setIsOrdersOpen(true);
  };

  const selectedPhotographer = null; // Replaced by profile view logic
  const photographerPhotos: Product[] = [];

  if (showDashboard) {
    if (loggedInPhotographer) {
      return (
        <PhotographerDashboard
          photographer={loggedInPhotographer}
          onLogout={handleLogout}
        />
      );
    }
    return (
      <PhotographerLogin
        onLoginSuccess={handlePhotographerLogin}
        onBack={() => setShowDashboard(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-brutal-white font-sans text-brutal-black selection:bg-brutal-accent selection:text-white pb-20">
      <Navbar
        cartItemCount={cart.length}
        onOpenCart={() => setIsCartOpen(true)}
        onNavigateHome={() => {
          clearSearch();
          setActiveView('photos');
        }}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSearch={handleSearch}
        onSelfieSearch={handleSelfieSearch}
        onOpenDashboard={() => setShowDashboard(true)}
        onOpenOrders={handleOpenOrders}
      />

      {selectedPhotographer ? (
        <PhotographerProfile
          photographer={selectedPhotographer}
          photos={photographerPhotos}
          onBack={() => setSelectedPhotographerId(null)}
          onAddToCart={handleAddToCart}
          cartItems={cart}
        />
      ) : (
        <>
          {!searchBib && !searchType && (
            <Hero
              onSearch={handleSearch}
              onSelfieSearch={handleSelfieSearch}
            />
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 text-brutal-accent animate-spin mb-4" />
              <p className="font-mono text-sm uppercase tracking-widest text-gray-500 animate-pulse">Carregando conteúdo...</p>
            </div>
          )}

          {!isLoading && (searchBib || searchType) && (
            <div className="max-w-350 mx-auto px-6 pt-12 pb-4">
              <button
                onClick={clearSearch}
                className="font-mono text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-4 flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
              <div className="bg-brutal-black text-white p-6 brutal-border brutal-shadow inline-block">
                <h2 className="font-mono text-sm uppercase tracking-widest text-gray-400 mb-1">Resultados</h2>
                <p className="font-display text-5xl">
                  {searchType === 'selfie' ? 'RECONHECIMENTO FACIAL' : `PEITO ${searchBib}`}
                </p>
              </div>
            </div>
          )}

          {!isLoading && (activeView === 'photos' ? (
            <PhotoGrid
              title={searchType ? 'SUAS FOTOS' : 'ÚLTIMOS LANÇAMENTOS'}
              subtitle={searchType ? `Encontramos fotos incríveis suas!` : 'FOTOS DOS ÚLTIMOS EVENTOS'}
              photos={displayPhotos}
              onAddToCart={handleAddToCart}
              cartItems={cart}
              activeView={activeView}
              onViewChange={setActiveView}
            />
          ) : (
            <VideoGrid
              videos={displayVideos}
              onAddToCart={handleAddToCart}
              cartItems={cart}
              activeView={activeView}
              onViewChange={setActiveView}
            />
          ))}

          {!searchType && activeView === 'photos' && (
            <div className="pb-20" />
          )}
        </>
      )}

      <AnimatePresence>
        {isAnalyzingSelfie && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 bg-brutal-black/90 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative mb-8">
              {selfieFile && (
                <div className="w-64 h-64 brutal-border overflow-hidden relative">
                  <img src={URL.createObjectURL(selfieFile)} alt="Selfie" className="w-full h-full object-cover" />
                  <motion.div
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    className="absolute left-0 w-full h-1 bg-brutal-accent shadow-[0_0_15px_#FF4D00] z-10"
                  />
                </div>
              )}
              <div className="absolute -top-4 -left-4 text-brutal-accent">
                <Scan className="w-12 h-12" />
              </div>
            </div>
            <h3 className="font-display text-4xl text-white mb-2 tracking-tighter uppercase">Analisando Face...</h3>
            <div className="flex items-center gap-2 text-brutal-accent font-mono text-sm tracking-[0.2em] uppercase">
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Mapeando Pontos</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cart}
        onRemoveItem={handleRemoveFromCart}
        isAuthenticated={Boolean(user)}
        onLoginRequested={() => setIsAuthOpen(true)}
        onCheckout={handleCheckout}
      />

      <CustomerOrdersDrawer
        isOpen={isOrdersOpen}
        onClose={() => setIsOrdersOpen(false)}
      />

      <AnimatePresence>
        {isAuthOpen && (
          <AuthView
            onClose={() => setIsAuthOpen(false)}
            onSuccess={() => setIsAuthOpen(false)}
          />
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}

// Admin Route Wrapper
function AdminRoute() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(isMockMode || Boolean(user?.isAdmin));
  const [photographers, setPhotographers] = useState<Photographer[]>([]);
  const [photos, setPhotos] = useState<Product[]>([]);
  const [videos, setVideos] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics>({
    grossRevenue: 0,
    platformFee: 0,
    paidOrders: 0,
    pendingOrders: 0,
    totalOrders: 0,
    totalProducts: 0,
    publishedProducts: 0,
    removedProducts: 0,
    photoCount: 0,
    videoCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [allPhotographers, allProducts, allOrders] = await Promise.all([
        photographerService.getAllPhotographers(),
        productService.getAdminProducts(1000),
        orderService.getAdminOrders(200)
      ]);

      // Compute photographer stats from real data to avoid relying on stored `photographers.stats` (which may be stale).
      const itemsByPhotographer = new Map<string, { photos: number; videos: number; orders: Set<string>; revenue: number }>();
      for (const product of allProducts) {
        const entry = itemsByPhotographer.get(product.vendedorId) ?? { photos: 0, videos: 0, orders: new Set<string>(), revenue: 0 };
        if (product.type === 'IMG') entry.photos += 1;
        if (product.type === 'VIDEO' || product.type === 'VIEW') entry.videos += 1;
        itemsByPhotographer.set(product.vendedorId, entry);
      }
      for (const order of allOrders) {
        if (order.status !== 'paid') continue;
        for (const item of order.items ?? []) {
          const entry = itemsByPhotographer.get(item.vendedorId) ?? { photos: 0, videos: 0, orders: new Set<string>(), revenue: 0 };
          entry.orders.add(order.id);
          entry.revenue += Number(item.price || 0);
          itemsByPhotographer.set(item.vendedorId, entry);
        }
      }

      const photographersWithStats = allPhotographers.map((photographer) => {
        const computed = itemsByPhotographer.get(photographer.id) ?? { photos: 0, videos: 0, orders: new Set<string>(), revenue: 0 };
        return {
          ...photographer,
          stats: {
            photos: computed.photos,
            events: photographer.stats?.events ?? 0,
            rating: photographer.stats?.rating ?? 5,
            totalEarnings: computed.revenue,
            pendingEarnings: photographer.stats?.pendingEarnings ?? 0,
            salesCount: computed.orders.size,
          },
        };
      });

      const paidOrders = allOrders.filter((order) => order.status === 'paid');
      const pendingOrders = allOrders.filter((order) => order.status === 'pending');
      const grossRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const publishedProducts = allProducts.filter((product) => (product.status ?? 'published') === 'published');
      const removedProducts = allProducts.filter((product) => product.status === 'removed');

      setPhotographers(photographersWithStats);
      setPhotos(allProducts.filter(p => p.type === 'IMG'));
      setVideos(allProducts.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
      setOrders(allOrders);
      setMetrics({
        grossRevenue,
        platformFee: grossRevenue * 0.3,
        paidOrders: paidOrders.length,
        pendingOrders: pendingOrders.length,
        totalOrders: allOrders.length,
        totalProducts: allProducts.length,
        publishedProducts: publishedProducts.length,
        removedProducts: removedProducts.length,
        photoCount: allProducts.filter((product) => product.type === 'IMG').length,
        videoCount: allProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
      });
    } catch (error) {
      console.error("Error loading admin data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, loadData]);

  React.useEffect(() => {
    if (!isMockMode) {
      setIsAdmin(Boolean(user?.isAdmin));
    }
  }, [user?.isAdmin]);

  const handleAdminLogout = async () => {
    if (!isMockMode) {
      await logout();
    }
    setIsAdmin(false);
  };

  if (!isAdmin) {
    return <AdminLogin onLoginSuccess={() => setIsAdmin(true)} onBack={() => window.location.href = '/'} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brutal-black flex flex-col items-center justify-center p-6 text-white">
        <Loader2 className="w-12 h-12 text-brutal-accent animate-spin mb-4" />
        <p className="font-mono text-sm uppercase tracking-widest animate-pulse text-gray-500">Acessando Terminal Admin...</p>
      </div>
    );
  }

  return (
    <AdminDashboard
      photographers={photographers}
      photos={photos}
      videos={videos}
      orders={orders}
      metrics={metrics}
      onLogout={handleAdminLogout}
      onRefresh={loadData}
    />
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin" element={<AdminRoute />} />
        <Route path="/" element={<Storefront />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

