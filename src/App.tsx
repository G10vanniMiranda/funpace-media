import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PhotoGrid } from './components/PhotoGrid';
import { VideoGrid } from './components/VideoGrid';
import { EventGrid } from './components/EventGrid';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutPage } from './components/CheckoutPage';
import { CustomerOrdersDrawer } from './components/CustomerOrdersDrawer';
import { Footer } from './components/Footer';
import { AuthView } from './components/AuthView';
import { PhotographerSection } from './components/PhotographerSection';
import { PhotographerProfile } from './components/PhotographerProfile';
import { PhotographerDashboard } from './components/PhotographerDashboard';
import { PhotographerLogin } from './components/PhotographerLogin';
import { PhotographerPasswordSetup } from './components/PhotographerPasswordSetup';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLogin } from './components/AdminLogin';
import { PagamentoSucesso } from './routes/pagamento/sucesso';
import { ParaFotografos } from './routes/ParaFotografos';
import { Precos } from './routes/Precos';
import { Faq } from './routes/Faq';
import { Contato } from './routes/Contato';
import { Termos } from './routes/Termos';
import { Privacidade } from './routes/Privacidade';
import { Product, Photographer, Buyer, AdminMetrics, Order, WithdrawalRequest } from './types';
import { useAuth } from './contexts/AuthContext';
import { isMockMode } from './lib/config';
import { productService, photographerService, orderService, withdrawalService, paymentService, platformSettingsService } from './lib/services';
import { logout } from './lib/supabase';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, CalendarDays, Camera, CheckCircle2, Image as ImageIcon, Loader2, MapPin, ReceiptText, Scan, Video, X, XCircle } from 'lucide-react';

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

const cartStorageKey = 'funpace:cart';

function isValidCartProductId(value: unknown) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !/[(),]/.test(value);
}

function normalizeEventName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function createEventSlug(value: string) {
  return normalizeEventName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'evento';
}

function getEventSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/eventos\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function loadStoredCart(): Product[] {
  try {
    const raw = localStorage.getItem(cartStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => isValidCartProductId(item?.id)) : [];
  } catch {
    return [];
  }
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
  const navigate = useNavigate();
  const location = useLocation();
  const [cart, setCart] = useState<Product[]>(() => loadStoredCart());
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [searchBib, setSearchBib] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'photos' | 'videos'>('photos');
  const [isAnalyzingSelfie, setIsAnalyzingSelfie] = useState(false);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [searchType, setSearchType] = useState<'bib' | 'selfie' | null>(null);
  const [selfieNotice, setSelfieNotice] = useState<{ previewUrl: string; fileName: string } | null>(null);
  const [selectedPhotographerId, setSelectedPhotographerId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [loggedInPhotographer, setLoggedInPhotographer] = useState<Photographer | null>(null);
  const [photos, setPhotos] = useState<Product[]>([]);
  const [videos, setVideos] = useState<Product[]>([]);
  const [selectedEventName, setSelectedEventName] = useState<string | null>(null);
  const [eventQuery, setEventQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<{
    status: 'paid' | 'pending' | 'cancelled';
    orderId?: string | null;
    message: string;
  } | null>(null);
  const eventSelfieInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const validCart = cart.filter((item) => isValidCartProductId(item.id));
    if (validCart.length !== cart.length) {
      setCart(validCart);
      return;
    }

    localStorage.setItem(cartStorageKey, JSON.stringify(validCart));
  }, [cart]);

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const products = await productService.getLatestProducts(200);
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
      async function confirmCheckoutPayment() {
        try {
          const response = await fetch('/api/checkout/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order: params.get('order') || params.get('order_nsu'),
              order_nsu: params.get('order_nsu'),
              transaction_nsu: params.get('transaction_nsu') || params.get('transaction_id') || params.get('transactionId'),
              transaction_id: params.get('transaction_id'),
              slug: params.get('slug'),
              invoice_slug: params.get('invoice_slug'),
              capture_method: params.get('capture_method'),
              payment: params.get('payment'),
              raw_query: Object.fromEntries(params.entries()),
            }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload?.error || payload?.message || 'Pagamento ainda nao confirmado.');
          }

          const orderId = params.get('order') || params.get('order_nsu');
          setPaymentNotice({
            status: 'paid',
            orderId,
            message: 'Pagamento confirmado. Seus arquivos digitais ja estao liberados para download.',
          });
          setHighlightedOrderId(orderId);
          setIsOrdersOpen(true);
          setCart([]);
        } catch (error: any) {
          console.error('Erro ao confirmar pagamento:', error);
          setPaymentNotice({
            status: 'pending',
            orderId: params.get('order') || params.get('order_nsu'),
            message: 'Recebemos o retorno do checkout. Se o pagamento foi aprovado, a liberacao acontecera quando a InfinitePay confirmar.',
          });
          setIsOrdersOpen(true);
        } finally {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }

      confirmCheckoutPayment();
    } else if (params.get('payment') === 'cancel') {
      setPaymentNotice({
        status: 'cancelled',
        orderId: params.get('order') || params.get('order_nsu'),
        message: 'O pagamento foi cancelado. O pedido continua disponivel para uma nova tentativa.',
      });
      setIsOrdersOpen(true);
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
    localStorage.setItem('funpace:photographer-id', photographer.id);
    localStorage.setItem('funpace:photographer-panel-active', 'true');
    setLoggedInPhotographer(photographer);
  };

  const handleLogout = async () => {
    localStorage.removeItem('funpace:photographer-id');
    localStorage.removeItem('funpace:photographer-panel-active');
    setLoggedInPhotographer(null);
    setShowDashboard(false);
    if (!isMockMode) {
      await logout();
    }
  };

  const displayPhotos = selectedEventName
    ? photos.filter((photo) => normalizeEventName(photo.event || '') === normalizeEventName(selectedEventName))
    : photos;
  const displayVideos = selectedEventName
    ? videos.filter((video) => normalizeEventName(video.event || '') === normalizeEventName(selectedEventName))
    : videos;
  const allDisplayProducts = React.useMemo(() => [...photos, ...videos], [photos, videos]);
  const eventNames = React.useMemo(() => (
    Array.from(new Map(
      allDisplayProducts.map((product) => {
        const eventName = String(product.event || 'Evento sem nome').trim();
        return [normalizeEventName(eventName), eventName] as const;
      }),
    ).values())
  ), [allDisplayProducts]);
  const selectedEventCheckpoints = Array.from(new Set(
    [...displayPhotos, ...displayVideos]
      .map((item) => item.checkpoint)
      .filter(Boolean),
  ));
  const selectedEventCover = displayPhotos[0]?.thumbnailUrl || displayPhotos[0]?.url || displayVideos[0]?.thumbnailUrl || displayVideos[0]?.url || '';
  const selectedEventDate = [...displayPhotos, ...displayVideos]
    .map((item) => item.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const selectedEventDateLabel = selectedEventDate
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(selectedEventDate))
    : 'Data a confirmar';
  const isEventsRoute = location.pathname === '/eventos';
  const eventSlugFromPath = getEventSlugFromPath(location.pathname);
  const isEventDetailRoute = Boolean(eventSlugFromPath);

  React.useEffect(() => {
    if (eventSlugFromPath) {
      const matchedEvent = eventNames.find((eventName) => createEventSlug(eventName) === eventSlugFromPath);
      setSelectedEventName(matchedEvent ?? null);
      setEventQuery('');
      setSearchBib(null);
      setSearchType(null);
      return;
    }

    if (isEventsRoute) {
      setSelectedEventName(null);
      setSearchBib(null);
      setSearchType(null);
    }
  }, [eventNames, eventSlugFromPath, isEventsRoute]);

  const handleAddToCart = (item: Product) => {
    if (!isValidCartProductId(item.id)) {
      alert('Esta midia precisa ser publicada novamente antes de ir para o checkout.');
      return;
    }

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
    setSelectedEventName(null);
    setEventQuery('');
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
      setSelfieNotice((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return {
          previewUrl: URL.createObjectURL(file),
          fileName: file.name,
        };
      });
    }, 3000);
  };

  const clearSearch = async () => {
    setIsLoading(true);
    setSearchBib(null);
    setSearchType(null);
    setSelfieFile(null);
    setSelectedPhotographerId(null);
    setSelectedEventName(null);
    setEventQuery('');

    try {
      const products = await productService.getLatestProducts(200);
      setPhotos(products.filter(p => p.type === 'IMG'));
      setVideos(products.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
    } catch (error) {
      console.error("Error clearing search:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const closeSelfieNotice = () => {
    setSelfieNotice((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setSelfieFile(null);
  };

  const handleCheckout = async (buyer: Buyer) => {
    setIsLoading(true);
    try {
      if (!user?.email) {
        setIsAuthOpen(true);
        return;
      }

      // 1. Criar sessão de pagamento no backend enviando os dados do comprador
      const checkoutTotal = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
      if (checkoutTotal <= 1) {
        throw new Error('A InfinitePay exige total maior que R$ 1,00 para gerar o checkout.');
      }

      const checkoutItems = cart.filter((item) => isValidCartProductId(item.id)).map(item => ({ id: item.id }));
      if (checkoutItems.length !== cart.length) {
        setCart(cart.filter((item) => isValidCartProductId(item.id)));
        throw new Error('Removemos midias antigas do carrinho. Adicione novamente as midias publicadas e tente outra vez.');
      }

      const result = await paymentService.createInfinitePayCheckout({
        userId: user.uid,
        buyer,
        items: checkoutItems,
        successUrl: `${window.location.origin}/pagamento/sucesso`,
        cancelUrl: `${window.location.origin}?payment=cancel`,
      });

      window.location.href = result.paymentUrl;

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

  if (location.pathname === '/checkout') {
    return (
      <>
        <CheckoutPage
          cartItems={cart}
          onRemoveItem={handleRemoveFromCart}
          onCheckout={handleCheckout}
          onLoginRequested={() => setIsAuthOpen(true)}
        />
        <AnimatePresence>
          {isAuthOpen && (
            <AuthView
              onClose={() => setIsAuthOpen(false)}
              onSuccess={() => setIsAuthOpen(false)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

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
          localStorage.removeItem('funpace:photographer-panel-active');
          clearSearch();
          setActiveView('photos');
          setSelectedEventName(null);
          setEventQuery('');
          navigate('/');
        }}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSearch={handleSearch}
        onSelfieSearch={handleSelfieSearch}
        onOpenDashboard={() => {
          localStorage.setItem('funpace:photographer-panel-active', 'true');
          navigate('/fotografo');
        }}
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
          {!isEventsRoute && !isEventDetailRoute && !searchBib && !searchType && !selectedEventName && (
            <Hero
              eventQuery={eventQuery}
              onEventQueryChange={setEventQuery}
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

          {!isLoading && !searchBib && !searchType && !selectedEventName && (
            <EventGrid
              products={allDisplayProducts}
              query={eventQuery}
              onSelectEvent={(eventName) => {
                setSelectedEventName(eventName);
                setEventQuery('');
                setActiveView('photos');
                navigate(`/eventos/${createEventSlug(eventName)}`);
              }}
            />
          )}

          {!isLoading && selectedEventName && !searchBib && !searchType && (
            <div className="max-w-[1400px] mx-auto px-4 md:px-6 pt-10 pb-4">
              <button
                onClick={() => {
                  setSelectedEventName(null);
                  navigate('/eventos');
                }}
                className="font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-6 flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar para eventos
              </button>

              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
                <div className="space-y-6">
                  <div className="bg-white brutal-border brutal-shadow p-5 md:p-8">
                    <p className="font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] text-brutal-accent font-bold mb-3">
                      Evento selecionado
                    </p>
                    <h1 className="font-display text-[clamp(2.35rem,8vw,5rem)] uppercase leading-[0.9] tracking-normal break-words">
                      {selectedEventName}
                    </h1>

                    <div className="mt-6 grid gap-3 border-t-2 border-dashed border-gray-200 pt-5 sm:grid-cols-2">
                      <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-gray-600">
                        <MapPin className="w-5 h-5 text-brutal-accent shrink-0" />
                        <span className="truncate">{selectedEventCheckpoints[0] || 'Local a confirmar'}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-gray-600">
                        <CalendarDays className="w-5 h-5 text-brutal-accent shrink-0" />
                        <span>{selectedEventDateLabel}</span>
                      </div>
                    </div>
                  </div>

                  {selectedEventCover && (
                    <div className="bg-white brutal-border brutal-shadow overflow-hidden">
                      <div className="aspect-[16/9] bg-brutal-black">
                        <img
                          src={selectedEventCover}
                          alt={selectedEventName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <aside className="space-y-4 lg:sticky lg:top-28">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white brutal-border p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mb-2">Fotos</p>
                      <div className="flex items-end justify-between gap-2">
                        <span className="font-display text-3xl leading-none">{displayPhotos.length}</span>
                        <Camera className="w-5 h-5 text-brutal-accent" />
                      </div>
                    </div>
                    <div className="bg-white brutal-border p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mb-2">Videos</p>
                      <div className="flex items-end justify-between gap-2">
                        <span className="font-display text-3xl leading-none">{displayVideos.length}</span>
                        <Video className="w-5 h-5 text-brutal-accent" />
                      </div>
                    </div>
                    <div className="bg-white brutal-border p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mb-2">Pontos</p>
                      <div className="flex items-end justify-between gap-2">
                        <span className="font-display text-3xl leading-none">{selectedEventCheckpoints.length || 1}</span>
                        <MapPin className="w-5 h-5 text-brutal-accent" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white brutal-border brutal-shadow p-5 md:p-6 text-center">
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-gray-500 mb-5">
                      Busque por reconhecimento facial
                    </p>
                    <button
                      type="button"
                      onClick={() => eventSelfieInputRef.current?.click()}
                      className="min-h-14 w-full px-6 bg-brutal-black text-white brutal-border brutal-shadow-hover font-display text-sm md:text-base uppercase tracking-widest inline-flex items-center justify-center gap-2"
                    >
                      <input
                        ref={eventSelfieInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleSelfieSearch(file);
                          event.target.value = '';
                        }}
                      />
                      <ImageIcon className="w-5 h-5 shrink-0" />
                      Selecionar selfie
                    </button>
                  </div>
                </aside>
              </div>
            </div>
          )}

          {!isLoading && (selectedEventName || searchBib || searchType) && (activeView === 'photos' ? (
            <PhotoGrid
              title={searchType ? 'SUAS FOTOS' : selectedEventName ? 'FOTOS DO EVENTO' : 'ÚLTIMOS LANÇAMENTOS'}
              subtitle={searchType ? `Encontramos fotos incríveis suas!` : selectedEventName ? 'Midias organizadas por evento' : 'FOTOS DOS ÚLTIMOS EVENTOS'}
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

          {!searchType && !selectedEventName && activeView === 'photos' && (
            <div className="pb-6 md:pb-20" />
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
        onOpenCheckout={() => {
          setIsCartOpen(false);
          navigate('/checkout');
        }}
      />

      <CustomerOrdersDrawer
        isOpen={isOrdersOpen}
        onClose={() => setIsOrdersOpen(false)}
        highlightedOrderId={highlightedOrderId}
      />

      <PaymentNoticeModal
        notice={paymentNotice}
        onClose={() => setPaymentNotice(null)}
        onOpenOrders={() => {
          setPaymentNotice(null);
          setIsOrdersOpen(true);
        }}
      />

      <SelfieNoticeModal
        notice={selfieNotice}
        onClose={closeSelfieNotice}
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

function SelfieNoticeModal({
  notice,
  onClose,
}: {
  notice: { previewUrl: string; fileName: string } | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {notice && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6">
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
            className="relative w-full max-w-lg overflow-hidden bg-white brutal-border brutal-shadow-heavy p-5 sm:p-8"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 text-gray-400 hover:text-brutal-black transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="h-24 w-24 shrink-0 overflow-hidden brutal-border bg-gray-50">
                <img src={notice.previewUrl} alt={notice.fileName} className="h-full w-full object-cover" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2">
                  Busca por selfie
                </p>
                <h2 className="max-w-full font-display text-[clamp(1.875rem,9vw,2.75rem)] uppercase tracking-normal leading-[0.95] break-words">
                  Em preparacao
                </h2>
                <p className="font-mono text-xs uppercase leading-relaxed text-gray-500 mt-4">
                  A busca facial automatica ainda nao esta ativa. Use o numero de peito para encontrar suas fotos enquanto essa etapa e validada.
                </p>

                <button
                  onClick={onClose}
                  className="mt-6 min-h-12 w-full px-5 py-3 bg-brutal-black text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent transition-colors cursor-pointer sm:w-auto"
                >
                  Buscar por numero
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function PaymentNoticeModal({
  notice,
  onClose,
  onOpenOrders,
}: {
  notice: { status: 'paid' | 'pending' | 'cancelled'; orderId?: string | null; message: string } | null;
  onClose: () => void;
  onOpenOrders: () => void;
}) {
  return (
    <AnimatePresence>
      {notice && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
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
              <div className={`p-4 brutal-border ${
                notice.status === 'paid' ? 'bg-green-50 text-green-600' :
                notice.status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
                'bg-red-50 text-red-600'
              }`}>
                {notice.status === 'paid' ? <CheckCircle2 className="w-8 h-8" /> : <XCircle className="w-8 h-8" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gray-400 mb-2 break-words">
                  Retorno da InfinitePay
                </p>
                <h2 className="max-w-full font-display text-[clamp(1.875rem,9vw,2.75rem)] uppercase tracking-normal leading-[0.95] break-words">
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
                    Abrir minhas compras
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
      )}
    </AnimatePresence>
  );
}

function PhotographerRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  React.useEffect(() => {
    async function loadLoggedPhotographer() {
      setIsLoading(true);
      try {
        const storedPhotographerId = localStorage.getItem('funpace:photographer-id');
        const photographerId = isMockMode ? (storedPhotographerId ?? user?.id) : user?.id;

        if (!photographerId) {
          if (!isMockMode) {
            localStorage.removeItem('funpace:photographer-id');
            localStorage.removeItem('funpace:photographer-panel-active');
          }
          setPhotographer(null);
          return;
        }

        const currentPhotographer = await photographerService.getPhotographerById(photographerId);
        if (currentPhotographer?.verified) {
          localStorage.setItem('funpace:photographer-id', currentPhotographer.id);
          setPhotographer(currentPhotographer);
        } else {
          if (!isMockMode) {
            localStorage.removeItem('funpace:photographer-id');
            localStorage.removeItem('funpace:photographer-panel-active');
          }
          setPhotographer(null);
        }
      } catch (error) {
        console.error('Error restoring photographer session:', error);
        setPhotographer(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadLoggedPhotographer();
  }, [user?.id]);

  const handleLoginSuccess = (loggedPhotographer: Photographer) => {
    localStorage.setItem('funpace:photographer-id', loggedPhotographer.id);
    localStorage.setItem('funpace:photographer-panel-active', 'true');
    setPhotographer(loggedPhotographer);
  };

  const handleLogout = async () => {
    localStorage.removeItem('funpace:photographer-id');
    localStorage.removeItem('funpace:photographer-panel-active');
    setPhotographer(null);
    if (!isMockMode) {
      await logout();
    }
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brutal-white flex flex-col items-center justify-center p-6">
        <Loader2 className="w-12 h-12 text-brutal-accent animate-spin mb-4" />
        <p className="font-mono text-sm uppercase tracking-widest text-gray-500 animate-pulse">Carregando painel...</p>
      </div>
    );
  }

  if (photographer) {
    return (
      <PhotographerDashboard
        photographer={photographer}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <PhotographerLogin
      onLoginSuccess={handleLoginSuccess}
      onBack={() => navigate('/')}
    />
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
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
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
      const [allPhotographers, allProducts, allOrders, allWithdrawals, platformSettings] = await Promise.all([
        photographerService.getAllPhotographers(),
        productService.getAdminProducts(1000),
        orderService.getAdminOrders(200),
        withdrawalService.getAdminWithdrawals(200),
        platformSettingsService.getPublicSettings(),
      ]);

      // Compute photographer stats from real data to avoid relying on stored `photographers.stats` (which may be stale).
      const activeProducts = allProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      const publishedProducts = allProducts.filter((product) => (product.status ?? 'published') === 'published');
      const activeProductIds = new Set(activeProducts.map((product) => product.id));
      const itemsByPhotographer = new Map<string, { photos: number; videos: number; orders: Set<string>; revenue: number }>();
      for (const product of activeProducts) {
        const entry = itemsByPhotographer.get(product.vendedorId) ?? { photos: 0, videos: 0, orders: new Set<string>(), revenue: 0 };
        if (product.type === 'IMG') entry.photos += 1;
        if (product.type === 'VIDEO' || product.type === 'VIEW') entry.videos += 1;
        itemsByPhotographer.set(product.vendedorId, entry);
      }
      for (const order of allOrders) {
        if (order.status !== 'paid') continue;
        for (const item of order.items ?? []) {
          if (!activeProductIds.has(item.productId)) continue;
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
      const platformFeeRate = Math.max(0, Math.min(100, Number(platformSettings.platformFeePercent) || 0)) / 100;
      const removedProducts = allProducts.filter((product) => product.status === 'removed');

      setPhotographers(photographersWithStats);
      setPhotos(activeProducts.filter(p => p.type === 'IMG'));
      setVideos(activeProducts.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
      setOrders(allOrders);
      setWithdrawals(allWithdrawals);
      setMetrics({
        grossRevenue,
        platformFee: grossRevenue * platformFeeRate,
        paidOrders: paidOrders.length,
        pendingOrders: pendingOrders.length,
        totalOrders: allOrders.length,
        totalProducts: activeProducts.length,
        publishedProducts: publishedProducts.length,
        removedProducts: removedProducts.length,
        photoCount: activeProducts.filter((product) => product.type === 'IMG').length,
        videoCount: activeProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
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
      withdrawals={withdrawals}
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
        <Route path="/fotografo/definir-senha" element={<PhotographerPasswordSetup />} />
        <Route path="/fotografo" element={<PhotographerRoute />} />
        <Route path="/checkout" element={<Storefront />} />
        <Route path="/eventos" element={<Storefront />} />
        <Route path="/eventos/:slug" element={<Storefront />} />
        <Route path="/para-fotografos" element={<ParaFotografos />} />
        <Route path="/precos" element={<Precos />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/contato" element={<Contato />} />
        <Route path="/termos" element={<Termos />} />
        <Route path="/privacidade" element={<Privacidade />} />
        <Route path="/pagar" element={<PagamentoSucesso />} />
        <Route path="/pagamento/sucesso" element={<PagamentoSucesso />} />
        <Route path="/" element={<Storefront />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

