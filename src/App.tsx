import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import type { HeroSearchResults } from './components/Hero';
import { PhotoGrid } from './components/PhotoGrid';
import { VideoGrid } from './components/VideoGrid';
import { EventGrid } from './components/EventGrid';
import { CartDrawer } from './components/CartDrawer';
import { Footer } from './components/Footer';
import { AuthView } from './components/AuthView';
import { PhotographerSection } from './components/PhotographerSection';
import { PhotographerProfile } from './components/PhotographerProfile';
import { PhotographerLogin } from './components/PhotographerLogin';
import { PhotographerPasswordSetup } from './components/PhotographerPasswordSetup';
import { AdminLogin } from './components/AdminLogin';
import { FaceSearchModal } from './components/FaceSearchModal';
import { PagamentoSucesso } from './routes/pagamento/sucesso';
import { ParaFotografos } from './routes/ParaFotografos';
import { Precos } from './routes/Precos';
import { Faq } from './routes/Faq';
import { Contato } from './routes/Contato';
import { Termos } from './routes/Termos';
import { Privacidade } from './routes/Privacidade';
import { Product, Photographer, Buyer, AdminMetrics, Order, WithdrawalRequest, Customer, PaymentRecord, PaymentEventLog, Coupon, AdminActivityLog, FaceSearchMatch } from './types';
import type { Event } from './types';
import { useAuth } from './contexts/AuthContext';
import { isMockMode } from './lib/config';
import { CheckoutPaymentMethod, adminService, customerAccountService, productService, photographerService, orderService, withdrawalService, paymentService, platformSettingsService, eventService, normalizePhotographerUsername, reservedPublicSlugs } from './lib/services';
import { clearStoredSession, logout } from './lib/supabase';
import { fetchProductEngagementCounts, loadFavoriteProducts, loadLikedProductIds, saveFavoriteProducts, saveLikedProductIds, setProductHeart } from './lib/customer-engagement';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, CalendarDays, Camera, CheckCircle2, Clock3, Image as ImageIcon, Images, Instagram, Loader2, MapPin, MessageCircle, ReceiptText, Scan, ScanFace, Search, Upload, UserCircle, Video, X, XCircle } from 'lucide-react';
import { useToast } from './contexts/ToastContext';
import { buildWhatsappUrl } from './lib/contact';

const CheckoutPage = React.lazy(() => import('./components/CheckoutPage').then((module) => ({ default: module.CheckoutPage })));
const CustomerOrdersPage = React.lazy(() => import('./components/CustomerOrdersDrawer').then((module) => ({ default: module.CustomerOrdersPage })));
const CustomerAccountPage = React.lazy(() => import('./components/CustomerAccountPage').then((module) => ({ default: module.CustomerAccountPage })));
const PhotographerDashboard = React.lazy(() => import('./components/PhotographerDashboard').then((module) => ({ default: module.PhotographerDashboard })));
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));

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
const storefrontProductLimit = 5000;

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

function getStorefrontTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value.includes('T') ? value : `${value}T12:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getEventSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/eventos\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getPublicPhotographerSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/fotografo\/(?!definir-senha(?:\/|$))([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getRootPublicPhotographerSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/@?([^/?#]+)\/?$/);
  if (!match) return null;
  const slug = normalizePhotographerUsername(decodeURIComponent(match[1]));
  if (!slug || reservedPublicSlugs.has(slug)) return null;
  return slug;
}

function getPublicEventSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/evento\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function formatPublicDate(value?: string | null) {
  if (!value) return 'Data a confirmar';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value.includes('T') ? value : `${value}T12:00:00`));
}

function getPhotographerPublicName(photographer: Photographer) {
  return photographer.displayName || photographer.name;
}

function setMetaTag(selector: string, attributes: Record<string, string>, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => meta?.setAttribute(key, value));
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function setLinkTag(selector: string, attributes: Record<string, string>) {
  let link = document.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    document.head.appendChild(link);
  }
  Object.entries(attributes).forEach(([key, value]) => link?.setAttribute(key, value));
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
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [cart, setCart] = useState<Product[]>(() => loadStoredCart());
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>(() => loadFavoriteProducts());
  const [likedProductIds, setLikedProductIds] = useState<Set<string>>(() => loadLikedProductIds());
  const [heartCounts, setHeartCounts] = useState<Record<string, number>>({});
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [searchBib, setSearchBib] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'photos' | 'videos'>('photos');
  const [searchType, setSearchType] = useState<'bib' | 'selfie' | null>(null);
  const [isFaceSearchOpen, setIsFaceSearchOpen] = useState(false);
  const [faceSearchMatches, setFaceSearchMatches] = useState<FaceSearchMatch[]>([]);
  const [selectedPhotographerId, setSelectedPhotographerId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [loggedInPhotographer, setLoggedInPhotographer] = useState<Photographer | null>(null);
  const [photos, setPhotos] = useState<Product[]>([]);
  const [videos, setVideos] = useState<Product[]>([]);
  const [registeredEvents, setRegisteredEvents] = useState<Event[]>([]);
  const [publicPhotographers, setPublicPhotographers] = useState<Photographer[]>([]);
  const [selectedEventName, setSelectedEventName] = useState<string | null>(null);
  const [eventQuery, setEventQuery] = useState('');
  const [debouncedEventQuery, setDebouncedEventQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [paymentNotice, setPaymentNotice] = useState<{
    status: 'paid' | 'pending' | 'cancelled' | 'canceled';
    orderId?: string | null;
    message: string;
  } | null>(null);

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
        const [products, eventRows, photographerRows] = await Promise.all([
          productService.getLatestProducts(storefrontProductLimit),
          eventService.getPublishedEvents(300).catch((error) => {
            console.warn('Eventos cadastrados indisponiveis na vitrine; usando apenas midias publicadas.', error);
            return [] as Event[];
          }),
          photographerService.getPublicPhotographers(1000).catch((error) => {
            console.warn('Fotografos publicos indisponiveis na busca global.', error);
            return [] as Photographer[];
          }),
        ]);
        setPhotos(products.filter(p => p.type === 'IMG'));
        setVideos(products.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
        setRegisteredEvents(eventRows);
        setPublicPhotographers(photographerRows);
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedEventQuery(eventQuery);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [eventQuery]);

  React.useEffect(() => {
    const ids = [...photos, ...videos].map((item) => item.id);
    if (ids.length === 0) return;

    fetchProductEngagementCounts(ids).then((counts) => {
      if (Object.keys(counts).length > 0) {
        setHeartCounts((current) => ({ ...current, ...counts }));
      }
    }).catch(() => {
      // Engagement counters are non-critical for browsing and checkout.
    });
  }, [photos, videos]);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mediaId = params.get('media');
    if (!mediaId || isLoading) return;

    const product = [...photos, ...videos].find((item) => item.id === mediaId);
    if (!product) return;

    setSelectedEventName(product.event || null);
    setActiveView(product.type === 'IMG' ? 'photos' : 'videos');
  }, [isLoading, location.search, photos, videos]);

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
              return_source: 'pagamento_sucesso',
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
          setCart([]);
        } catch (error: any) {
          console.error('Erro ao confirmar pagamento:', error);
          setPaymentNotice({
            status: 'pending',
            orderId: params.get('order') || params.get('order_nsu'),
            message: 'Recebemos o retorno do checkout. Se o pagamento foi aprovado, a liberacao acontecera quando a InfinitePay confirmar.',
          });
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
    clearStoredSession('customer');
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

  const eventPhotos = selectedEventName
    ? photos.filter((photo) => normalizeEventName(photo.event || '') === normalizeEventName(selectedEventName))
    : photos;
  const displayPhotos = searchType === 'selfie'
    ? faceSearchMatches.map((match) => match.product).filter((product) => product.type === 'IMG')
    : eventPhotos;
  const displayVideos = searchType === 'selfie'
    ? []
    : selectedEventName
      ? videos.filter((video) => normalizeEventName(video.event || '') === normalizeEventName(selectedEventName))
      : videos;
  const allDisplayProducts = React.useMemo(() => [...photos, ...videos], [photos, videos]);
  const eventNames = React.useMemo(() => (
    Array.from(new Map(
      [
        ...registeredEvents
          .filter((eventItem) => eventItem.isPublished !== false)
          .map((eventItem) => {
            const eventName = String(eventItem.name || 'Evento sem nome').trim();
            return [normalizeEventName(eventName), eventName] as const;
          }),
        ...allDisplayProducts.map((product) => {
          const eventName = String(product.event || 'Evento sem nome').trim();
          return [normalizeEventName(eventName), eventName] as const;
        }),
      ],
    ).values())
  ), [allDisplayProducts, registeredEvents]);
  const globalSearchResults = React.useMemo<HeroSearchResults>(() => {
    const normalizedQuery = normalizeEventName(debouncedEventQuery.trim());
    if (!normalizedQuery) return { photographers: [], events: [], photos: [] };

    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const matches = (value: string) => {
      const normalizedValue = normalizeEventName(value);
      return queryTokens.every((token) => normalizedValue.includes(token));
    };

    const productsByPhotographer = new Map<string, Product[]>();
    const productsByEvent = new Map<string, Product[]>();
    for (const product of allDisplayProducts) {
      if (product.vendedorId) {
        const photographerProducts = productsByPhotographer.get(product.vendedorId) ?? [];
        photographerProducts.push(product);
        productsByPhotographer.set(product.vendedorId, photographerProducts);
      }

      const eventName = String(product.event || 'Evento sem nome').trim();
      const eventKey = normalizeEventName(eventName);
      const eventProducts = productsByEvent.get(eventKey) ?? [];
      eventProducts.push(product);
      productsByEvent.set(eventKey, eventProducts);
    }

    const photographerResults = publicPhotographers
      .filter((photographer) => matches([
        photographer.name,
        photographer.displayName || '',
        photographer.username || '',
        photographer.slug || '',
        photographer.city || '',
        photographer.instagram || '',
      ].join(' ')))
      .slice(0, 5)
      .map((photographer) => {
        const photographerProducts = productsByPhotographer.get(photographer.id) ?? [];
        const photographerEventKeys = new Set([
          ...registeredEvents
            .filter((eventItem) => eventItem.photographerId === photographer.id && eventItem.isPublished !== false)
            .map((eventItem) => normalizeEventName(eventItem.name || '')),
          ...photographerProducts.map((product) => normalizeEventName(product.event || '')),
        ].filter(Boolean));

        return {
          photographer,
          eventCount: photographerEventKeys.size || photographer.stats?.events || 0,
          photoCount: photographerProducts.filter((product) => product.type === 'IMG').length || photographer.stats?.photos || 0,
        };
      });

    const eventMap = new Map<string, { name: string; city: string; photoCount: number; text: string; sortTime: number }>();
    for (const eventItem of registeredEvents) {
      if (eventItem.isPublished === false) continue;
      const name = String(eventItem.name || 'Evento sem nome').trim();
      const key = normalizeEventName(name);
      const eventProducts = productsByEvent.get(key) ?? [];
      eventMap.set(key, {
        name,
        city: eventItem.location || eventItem.checkpoint || '',
        photoCount: eventProducts.filter((product) => product.type === 'IMG').length,
        text: [name, eventItem.location || '', eventItem.checkpoint || '', eventItem.description || ''].join(' '),
        sortTime: getStorefrontTimestamp(eventItem.createdAt) || getStorefrontTimestamp(eventItem.date),
      });
    }
    for (const [key, eventProducts] of productsByEvent.entries()) {
      if (eventMap.has(key)) continue;
      const first = eventProducts[0];
      const name = String(first?.event || 'Evento sem nome').trim();
      eventMap.set(key, {
        name,
        city: first?.checkpoint || '',
        photoCount: eventProducts.filter((product) => product.type === 'IMG').length,
        text: [name, first?.checkpoint || ''].join(' '),
        sortTime: eventProducts.reduce((latest, product) => Math.max(latest, getStorefrontTimestamp(product.createdAt)), 0),
      });
    }

    const matchedPhotographerIds = new Set(photographerResults.map((result) => result.photographer.id));
    const eventResults = Array.from(eventMap.values())
      .filter((eventItem) => {
        if (matches(eventItem.text)) return true;
        const eventProducts = productsByEvent.get(normalizeEventName(eventItem.name)) ?? [];
        return eventProducts.some((product) => matchedPhotographerIds.has(product.vendedorId));
      })
      .sort((left, right) => right.sortTime - left.sortTime || left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }))
      .slice(0, 6)
      .map(({ name, city, photoCount }) => ({ name, city, photoCount }));

    const photoResults = allDisplayProducts
      .filter((product) =>
        matches([
          product.name,
          product.event,
          product.checkpoint,
          product.bib,
          product.originalFileName || '',
        ].join(' ')) ||
        matchedPhotographerIds.has(product.vendedorId)
      )
      .slice(0, 6);

    return { photographers: photographerResults, events: eventResults, photos: photoResults };
  }, [allDisplayProducts, debouncedEventQuery, publicPhotographers, registeredEvents]);
  const selectedRegisteredEvent = React.useMemo(() => (
    selectedEventName
      ? (() => {
        const matchingEvents = registeredEvents.filter((eventItem) =>
          eventItem.isPublished !== false && normalizeEventName(eventItem.name) === normalizeEventName(selectedEventName),
        );
        if (matchingEvents.length <= 1) return matchingEvents[0] ?? null;

        const sellerIds = new Set([...displayPhotos, ...displayVideos].map((product) => product.vendedorId).filter(Boolean));
        const sellerEvent = matchingEvents.find((eventItem) =>
          eventItem.photographerId && sellerIds.has(eventItem.photographerId),
        );
        if (sellerEvent) return sellerEvent;

        return [...matchingEvents].sort((left, right) => {
          const leftTime = getStorefrontTimestamp(left.createdAt) || getStorefrontTimestamp(left.date);
          const rightTime = getStorefrontTimestamp(right.createdAt) || getStorefrontTimestamp(right.date);
          return rightTime - leftTime;
        })[0] ?? null;
      })()
      : null
  ), [displayPhotos, displayVideos, registeredEvents, selectedEventName]);
  const selectedEventCheckpoints = Array.from(new Set(
    [
      selectedRegisteredEvent?.checkpoint || selectedRegisteredEvent?.location || '',
      ...[...displayPhotos, ...displayVideos].map((item) => item.checkpoint),
    ]
      .filter(Boolean),
  ));
  const selectedEventCover = selectedRegisteredEvent?.coverImage ||
    displayPhotos.find((photo) => photo.thumbnailUrl)?.thumbnailUrl ||
    displayVideos.find((video) => video.thumbnailUrl)?.thumbnailUrl ||
    '';
  const selectedEventDate = selectedRegisteredEvent?.date || [...displayPhotos, ...displayVideos]
    .map((item) => item.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const selectedEventDateLabel = selectedEventDate
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(selectedEventDate.includes('T') ? selectedEventDate : `${selectedEventDate}T12:00:00`))
    : 'Data a confirmar';
  const selectedEventPhotographer = React.useMemo(() => {
    if (!selectedEventName) return null;
    if (selectedRegisteredEvent?.photographerId) {
      const owner = publicPhotographers.find((photographer) => photographer.id === selectedRegisteredEvent.photographerId);
      if (owner) return owner;
    }

    const sellerId = [...displayPhotos, ...displayVideos].find((product) => product.vendedorId)?.vendedorId;
    return sellerId ? publicPhotographers.find((photographer) => photographer.id === sellerId) ?? null : null;
  }, [displayPhotos, displayVideos, publicPhotographers, selectedEventName, selectedRegisteredEvent?.photographerId]);
  const selectedEventCategory = selectedRegisteredEvent?.status === 'scheduled'
    ? 'Proximo evento'
    : selectedRegisteredEvent?.status === 'closed'
      ? 'Evento encerrado'
      : selectedRegisteredEvent?.status === 'active'
        ? 'Evento ativo'
        : 'Evento esportivo';
  const isEventsRoute = location.pathname === '/eventos';
  const isCustomerOrdersRoute = location.pathname === '/minhas-compras';
  const eventSlugFromPath = getEventSlugFromPath(location.pathname);
  const publicPhotographerSlug = getPublicPhotographerSlugFromPath(location.pathname);
  const rootPublicPhotographerSlug = getRootPublicPhotographerSlugFromPath(location.pathname);
  const activePublicPhotographerSlug = publicPhotographerSlug || rootPublicPhotographerSlug;
  const publicEventSlug = getPublicEventSlugFromPath(location.pathname);
  const isEventDetailRoute = Boolean(eventSlugFromPath);

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

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

  const handleToggleFavorite = (item: Product) => {
    const shouldLike = !likedProductIds.has(item.id);

    setFavoriteProducts((current) => {
      const exists = current.some((favorite) => favorite.id === item.id);
      const next = exists ? current.filter((favorite) => favorite.id !== item.id) : [item, ...current];
      saveFavoriteProducts(next);
      return next;
    });

    setLikedProductIds((current) => {
      const next = new Set(current);
      if (shouldLike) next.add(item.id);
      else next.delete(item.id);
      saveLikedProductIds(next);
      return next;
    });

    setHeartCounts((current) => ({
      ...current,
      [item.id]: Math.max(0, Number(current[item.id] || item.favoriteCount || 0) + (shouldLike ? 1 : -1)),
    }));

    setProductHeart(item.id, shouldLike).then((count) => {
      setHeartCounts((current) => ({ ...current, [item.id]: count }));
      customerAccountService.setFavorite(item, shouldLike).catch(() => undefined);
      showToast(shouldLike ? 'Favorito salvo.' : 'Favorito removido.', 'success');
    }).catch(() => {
      setHeartCounts((current) => ({
        ...current,
        [item.id]: Math.max(0, Number(current[item.id] || 0) + (shouldLike ? -1 : 1)),
      }));
      setLikedProductIds((current) => {
        const next = new Set(current);
        if (shouldLike) next.delete(item.id);
        else next.add(item.id);
        saveLikedProductIds(next);
        return next;
      });
      showToast('Nao foi possivel atualizar o favorito.', 'error');
    });
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

  const openPublicPhotographer = (photographer: Photographer) => {
    const slug = normalizePhotographerUsername(photographer.username || photographer.slug || photographer.displayName || photographer.name);
    if (!slug || reservedPublicSlugs.has(slug)) return;
    setEventQuery('');
    setSelectedEventName(null);
    setSearchBib(null);
    setSearchType(null);
    navigate(`/${slug}`);
  };

  const openGlobalEventResult = (eventName: string) => {
    setSelectedEventName(eventName);
    setEventQuery('');
    setSearchBib(null);
    setSearchType(null);
    setActiveView('photos');
    navigate(`/eventos/${createEventSlug(eventName)}`);
  };

  const openGlobalPhotoResult = (product: Product) => {
    setEventQuery('');
    if (product.bib) {
      handleSearch(product.bib);
      return;
    }

    openGlobalEventResult(product.event || 'Evento sem nome');
  };

  const handleSelfieSearch = async (file: File, sessionId: string) => {
    const selectedEvent = selectedRegisteredEvent;
    if (!selectedEvent?.id) {
      throw new Error('Abra um evento antes de enviar a selfie.');
    }
    setSearchBib(null);
    setSelectedPhotographerId(null);
    setEventQuery('');
    setShowDashboard(false);

    const matches = await productService.searchByFace(file, selectedEvent.id, sessionId);
    setFaceSearchMatches(matches);
    setSearchType('selfie');
    setActiveView('photos');
    if (matches.length === 0) {
      showToast('Nenhuma foto sua foi encontrada neste evento. Tente utilizar outra selfie.', 'info');
    }
    return matches;
  };

  const clearFaceSearch = () => {
    setSearchType(null);
    setFaceSearchMatches([]);
    setActiveView('photos');
  };

  const clearSearch = async () => {
    setIsLoading(true);
    setSearchBib(null);
    setSearchType(null);
    setFaceSearchMatches([]);
    setSelectedPhotographerId(null);
    setSelectedEventName(null);
    setEventQuery('');

    try {
      const products = await productService.getLatestProducts(storefrontProductLimit);
      setPhotos(products.filter(p => p.type === 'IMG'));
      setVideos(products.filter(p => p.type === 'VIDEO' || p.type === 'VIEW'));
    } catch (error) {
      console.error("Error clearing search:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (buyer: Buyer, paymentMethod: CheckoutPaymentMethod = 'checkout', couponCode?: string) => {
    setIsLoading(true);
    try {
      if (!user?.email) {
        setIsAuthOpen(true);
        throw new Error('Entre para finalizar a compra.');
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

      const result = await paymentService.createCheckout({
        userId: user.uid,
        buyer,
        items: checkoutItems,
        successUrl: `${window.location.origin}/pagamento/sucesso`,
        cancelUrl: `${window.location.origin}?payment=cancel`,
        paymentMethod,
        couponCode,
      });

      return result;

    } catch (error: any) {
      console.error("Erro no checkout:", error);
      alert("Erro ao processar checkout: " + error.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenOrders = () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    navigate('/minha-conta');
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

  if (isCustomerOrdersRoute) {
    const params = new URLSearchParams(location.search);
    const orderId = params.get('order');
    const status = params.get('status');
    const paymentStatus = status === 'paid' || status === 'pending' || status === 'cancelled' || status === 'canceled' ? status : null;

    return (
      <div className="min-h-screen bg-brutal-white font-sans text-brutal-black selection:bg-brutal-accent selection:text-white">
        <Navbar
          cartItemCount={cart.length}
          onOpenCart={() => setIsCartOpen(true)}
          onNavigateHome={() => {
            clearSearch();
            navigate('/');
          }}
          onOpenAuth={() => setIsAuthOpen(true)}
          onSearch={handleSearch}
          onOpenDashboard={() => {
            localStorage.setItem('funpace:photographer-panel-active', 'true');
            navigate('/fotografo');
          }}
          onOpenOrders={() => navigate('/minha-conta')}
          onOpenAccount={() => navigate('/minha-conta')}
        />

        <CustomerOrdersPage
          highlightedOrderId={orderId}
          paymentStatus={paymentStatus}
          favoriteProducts={favoriteProducts}
          isAuthenticated={Boolean(user)}
          onLoginRequested={() => setIsAuthOpen(true)}
          onAddToCart={handleAddToCart}
          onToggleFavorite={handleToggleFavorite}
        />

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

        <AnimatePresence>
          {isAuthOpen && (
            <AuthView
              onClose={() => setIsAuthOpen(false)}
              onSuccess={() => setIsAuthOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
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
        onOpenDashboard={() => {
          localStorage.setItem('funpace:photographer-panel-active', 'true');
          navigate('/fotografo');
        }}
        onOpenOrders={handleOpenOrders}
        onOpenAccount={() => user ? navigate('/minha-conta') : setIsAuthOpen(true)}
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
          {publicPhotographerSlug && (
            <Navigate to={`/${publicPhotographerSlug}`} replace />
          )}

          {activePublicPhotographerSlug && !publicPhotographerSlug && (
            <PublicPhotographerPage
              slug={activePublicPhotographerSlug}
              cartItems={cart}
              favoriteProducts={favoriteProducts}
              likedProductIds={likedProductIds}
              heartCounts={heartCounts}
              onAddToCart={handleAddToCart}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {publicEventSlug && !activePublicPhotographerSlug && (
            <PublicEventPage
              slug={publicEventSlug}
              cartItems={cart}
              favoriteProducts={favoriteProducts}
              likedProductIds={likedProductIds}
              heartCounts={heartCounts}
              onAddToCart={handleAddToCart}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {!activePublicPhotographerSlug && !publicEventSlug && (
            <>
          {!isEventsRoute && !isEventDetailRoute && !searchBib && !searchType && !selectedEventName && (
            <Hero
              eventQuery={eventQuery}
              onEventQueryChange={setEventQuery}
              searchResults={globalSearchResults}
              isSearching={eventQuery.trim() !== debouncedEventQuery.trim()}
              onSelectPhotographer={openPublicPhotographer}
              onSelectEvent={openGlobalEventResult}
              onSelectPhoto={openGlobalPhotoResult}
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
                onClick={searchType === 'selfie' ? clearFaceSearch : clearSearch}
                className="font-mono text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-4 flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                {searchType === 'selfie' ? 'Limpar Busca' : 'Voltar'}
              </button>
              <div className="bg-brutal-black text-white p-6 brutal-border brutal-shadow inline-block">
                <h2 className="font-mono text-sm uppercase tracking-widest text-gray-400 mb-1">Resultados</h2>
                <p className="font-display text-5xl">
                  {searchType === 'selfie' ? `FOTOS ENCONTRADAS (${displayPhotos.length})` : `PEITO ${searchBib}`}
                </p>
                {searchType === 'selfie' && (
                  <p className="mt-3 font-mono text-xs uppercase tracking-widest text-gray-300">
                    Resultado facial dentro de {selectedEventName || 'este evento'}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isLoading && !searchBib && !searchType && !selectedEventName && (
            <EventGrid
              products={allDisplayProducts}
              registeredEvents={registeredEvents}
              query={debouncedEventQuery}
              onSelectEvent={openGlobalEventResult}
            />
          )}

          {!isLoading && selectedEventName && !searchBib && !searchType && (
            <div className="max-w-350 mx-auto px-4 md:px-6 pt-6 pb-2">
              <button
                onClick={() => {
                  setSelectedEventName(null);
                  navigate('/eventos');
                }}
                className="font-mono text-xs md:text-sm tracking-widest uppercase text-gray-500 hover:text-brutal-accent transition-colors mb-5 flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar para eventos
              </button>

              <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.48fr)_minmax(0,1fr)] lg:items-stretch">
                  <div className="relative min-h-52 overflow-hidden rounded-[1.35rem] bg-brutal-black shadow-[0_14px_34px_rgba(5,5,5,0.16)] sm:min-h-72 lg:min-h-0">
                    {selectedEventCover ? (
                      <img
                        src={selectedEventCover}
                        alt={selectedEventName}
                        loading="eager"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-white/35">
                        <ImageIcon className="h-16 w-16" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-black/10" />
                    <span className="absolute left-4 top-4 rounded-full bg-brutal-accent px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white shadow-lg">
                      {selectedEventCategory}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-brutal-accent">
                          Evento selecionado
                        </p>
                        <h1 className="mt-2 max-w-4xl font-sans text-[clamp(1.9rem,3.8vw,3.5rem)] font-black uppercase leading-[0.95] tracking-tight text-brutal-black wrap-break-word">
                          {selectedEventName}
                        </h1>
                      </div>
                      <div className="shrink-0 rounded-2xl bg-[#f7f7f4] px-4 py-3 ring-1 ring-black/10">
                        <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-gray-400">Loja criada por</p>
                        <p className="mt-1 font-display text-sm uppercase text-brutal-black">
                          {selectedEventPhotographer ? getPhotographerPublicName(selectedEventPhotographer) : 'Funpace Media'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 border-y border-black/10 py-4 sm:grid-cols-2 xl:grid-cols-4">
                      <EventMeta icon={<CalendarDays className="h-4 w-4" />} label="Data" value={selectedEventDateLabel} />
                      <EventMeta icon={<MapPin className="h-4 w-4" />} label="Cidade" value={selectedEventCheckpoints[0] || 'Local a confirmar'} />
                      <EventMeta icon={<Camera className="h-4 w-4" />} label="Categoria" value={selectedEventCategory} />
                      <EventMeta icon={<Clock3 className="h-4 w-4" />} label="Expiracao" value="Sem data definida" />
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
                      <EventCompactStat icon={<Images className="h-4 w-4" />} label="Fotos" value={displayPhotos.length} />
                      <EventCompactStat icon={<Video className="h-4 w-4" />} label="Videos" value={displayVideos.length} />
                      <EventCompactStat icon={<MapPin className="h-4 w-4" />} label="Pontos" value={selectedEventCheckpoints.length || 1} />
                    </div>
                  </div>
                </div>

                <div className="mx-auto mt-5 max-w-4xl rounded-[1.5rem] border border-black/10 bg-linear-to-br from-white via-[#fffdf3] to-[#f3f3ef] p-4 shadow-[0_14px_42px_rgba(5,5,5,0.10)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(5,5,5,0.14)] sm:p-5">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="flex items-center gap-4">
                      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brutal-black text-brutal-accent shadow-inner ring-1 ring-white/40 sm:h-20 sm:w-20">
                        <ScanFace className="h-8 w-8 sm:h-10 sm:w-10" />
                      </div>
                      <div>
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-gray-500">Reconhecimento facial</p>
                        <h2 className="mt-1 max-w-lg font-display text-2xl uppercase leading-tight text-brutal-black sm:text-3xl">
                          Encontre suas fotos com Reconhecimento facial
                        </h2>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFaceSearchOpen(true)}
                      disabled={!selectedRegisteredEvent?.id}
                      aria-label="Encontrar minhas fotos com selfie"
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brutal-accent px-6 font-display text-sm uppercase tracking-wider text-white shadow-[0_10px_24px_rgba(255,77,0,0.25)] transition-all hover:-translate-y-0.5 hover:bg-brutal-black disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                    >
                      <Scan className="h-4 w-4" />
                      Tirar selfie
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 border-t border-black/10 pt-4 sm:flex-row sm:items-center sm:justify-end">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500 sm:mr-auto">Voce tambem pode:</span>
                    <button
                      type="button"
                      onClick={() => setIsFaceSearchOpen(true)}
                      disabled={!selectedRegisteredEvent?.id}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-5 font-mono text-[10px] font-bold uppercase tracking-wider text-brutal-black transition-colors hover:border-brutal-accent hover:text-brutal-accent disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      Carregar foto
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isLoading && (selectedEventName || searchBib || searchType) && (activeView === 'photos' ? (
            <PhotoGrid
              title={searchType === 'selfie' ? `FOTOS ENCONTRADAS (${displayPhotos.length})` : searchType ? 'SUAS FOTOS' : selectedEventName ? 'FOTOS DO EVENTO' : 'ULTIMOS LANCAMENTOS'}
              subtitle={searchType === 'selfie'
                ? displayPhotos.length > 0
                  ? `Encontramos ${displayPhotos.length} ${displayPhotos.length === 1 ? 'foto sua' : 'fotos suas'} neste evento.`
                  : 'Nenhuma foto sua foi encontrada neste evento. Tente utilizar outra selfie.'
                : searchType ? 'Resultados filtrados por numero de peito.' : selectedEventName ? 'Midias organizadas por evento' : 'FOTOS DOS ULTIMOS EVENTOS'}
              photos={displayPhotos}
              onAddToCart={handleAddToCart}
              cartItems={cart}
              activeView={activeView}
              onViewChange={setActiveView}
              favoriteIds={new Set(favoriteProducts.map((item) => item.id))}
              likedIds={likedProductIds}
              heartCounts={heartCounts}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : (
            <VideoGrid
              videos={displayVideos}
              onAddToCart={handleAddToCart}
              cartItems={cart}
              activeView={activeView}
              onViewChange={setActiveView}
              favoriteIds={new Set(favoriteProducts.map((item) => item.id))}
              likedIds={likedProductIds}
              heartCounts={heartCounts}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}

          {!searchType && !selectedEventName && activeView === 'photos' && (
            <div className="pb-6 md:pb-20" />
          )}
            </>
          )}
        </>
      )}

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

      <PaymentNoticeModal
        notice={paymentNotice}
        onClose={() => setPaymentNotice(null)}
        onOpenOrders={() => {
          const orderQuery = paymentNotice?.orderId ? `?order=${encodeURIComponent(paymentNotice.orderId)}` : '';
          setPaymentNotice(null);
          navigate(`/minha-conta${orderQuery}`);
        }}
      />

      <FaceSearchModal
        isOpen={isFaceSearchOpen}
        eventName={selectedEventName || 'Evento'}
        onClose={() => setIsFaceSearchOpen(false)}
        onSearch={handleSelfieSearch}
      />

      <FloatingWhatsappSupport />

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

type PublicPageCartProps = {
  cartItems: Product[];
  favoriteProducts: Product[];
  likedProductIds: Set<string>;
  heartCounts: Record<string, number>;
  onAddToCart: (product: Product) => void;
  onToggleFavorite: (product: Product) => void;
};

type PublicPhotographerAlbum = {
  id: string;
  name: string;
  slug?: string | null;
  date?: string | null;
  city: string;
  description?: string | null;
  coverUrl: string | null;
  sortTime: number;
  products: Product[];
  event?: Event | null;
};

function PublicPhotographerPage({
  slug,
  cartItems,
  favoriteProducts,
  likedProductIds,
  heartCounts,
  onAddToCart,
  onToggleFavorite,
}: PublicPageCartProps & { slug: string }) {
  const navigate = useNavigate();
  const [photographer, setPhotographer] = React.useState<Photographer | null>(null);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [query, setQuery] = React.useState('');
  const [cityFilter, setCityFilter] = React.useState('');
  const [dateFilter, setDateFilter] = React.useState('');
  const [activeView, setActiveView] = React.useState<'events' | 'photos'>('events');
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function loadPublicPhotographer() {
      setIsLoading(true);
      try {
        const profile = await photographerService.getPublicPhotographerBySlug(slug);
        if (!profile) {
          if (!cancelled) setPhotographer(null);
          return;
        }
        const [profileEvents, profileProducts] = await Promise.all([
          eventService.getPublishedPhotographerEvents(profile.id, 300),
          productService.getPublishedProductsByPhotographer(profile.id, storefrontProductLimit),
        ]);
        if (cancelled) return;
        console.info('[public-photographer] fotografo encontrado', {
          photographerId: profile.id,
          username: profile.username,
          slug: profile.slug,
          displayName: profile.displayName || profile.name,
        });
        console.info('[public-photographer] eventos retornados pela query', {
          count: profileEvents.length,
          events: profileEvents.map((event) => ({
            eventId: event.id,
            name: event.name,
            coverImage: event.coverImage || null,
            coverMediaId: event.coverMediaId || null,
          })),
        });
        console.info('[public-photographer] midias retornadas para o fotografo', {
          count: profileProducts.length,
        });
        setPhotographer(profile);
        setEvents(profileEvents);
        setProducts(profileProducts);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadPublicPhotographer().catch((error) => {
      console.error('Erro ao carregar perfil publico do fotografo:', error);
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  React.useEffect(() => {
    if (!photographer) return;
    const titleName = getPhotographerPublicName(photographer);
    const publicSlug = photographer.username || photographer.slug || slug;
    const canonicalUrl = `${window.location.origin}/${publicSlug}`;
    const title = `${titleName} - Fotografo Oficial | Funpace Media`;
    const description = `Perfil publico de ${titleName}${photographer.city ? ` em ${photographer.city}` : ''}: eventos, albuns e fotos na Funpace Media.`;
    document.title = title;
    setLinkTag('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });
    setMetaTag('meta[name="description"]', { name: 'description' }, description);
    setMetaTag('meta[property="og:title"]', { property: 'og:title' }, title);
    setMetaTag('meta[property="og:description"]', { property: 'og:description' }, description);
    setMetaTag('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    setMetaTag('meta[property="og:type"]', { property: 'og:type' }, 'profile');
    setMetaTag('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    setMetaTag('meta[name="twitter:title"]', { name: 'twitter:title' }, title);
    setMetaTag('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
    const ogImage = photographer.coverPhoto || photographer.profilePhoto || photographer.avatar;
    if (ogImage) {
      setMetaTag('meta[property="og:image"]', { property: 'og:image' }, ogImage);
      setMetaTag('meta[name="twitter:image"]', { name: 'twitter:image' }, ogImage);
    }
  }, [photographer, slug]);

  const normalizedQuery = normalizeEventName(query.trim());
  const productsByEvent = React.useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products) {
      const key = normalizeEventName(product.event || 'Evento sem nome');
      const current = map.get(key) ?? [];
      current.push(product);
      map.set(key, current);
    }
    return map;
  }, [products]);

  const publicAlbums = React.useMemo<PublicPhotographerAlbum[]>(() => {
    const albums = new Map<string, PublicPhotographerAlbum>();

    for (const event of events.filter((item) => item.isPublished !== false)) {
      const eventName = String(event.name || 'Evento sem nome').trim();
      const key = normalizeEventName(eventName);
      const eventProducts = productsByEvent.get(key) ?? [];
      const coverProduct = eventProducts.find((product) => product.thumbnailUrl) ?? eventProducts[0];
      const latestProductTime = Math.max(0, ...eventProducts.map((product) => getStorefrontTimestamp(product.createdAt)));
      albums.set(key, {
        id: event.id,
        name: eventName,
        slug: event.slug,
        date: event.date,
        city: event.location || event.checkpoint || '',
        description: event.description,
        coverUrl: event.bannerImage || event.coverImage || coverProduct?.thumbnailUrl || null,
        sortTime: Math.max(getStorefrontTimestamp(event.date), getStorefrontTimestamp(event.createdAt), latestProductTime),
        products: eventProducts,
        event,
      });
    }

    for (const [key, eventProducts] of productsByEvent.entries()) {
      const eventName = String(eventProducts[0]?.event || 'Evento sem nome').trim();
      const coverProduct = eventProducts.find((product) => product.thumbnailUrl) ?? eventProducts[0];
      const latestProductTime = Math.max(0, ...eventProducts.map((product) => getStorefrontTimestamp(product.createdAt)));
      const existing = albums.get(key);

      if (existing) {
        albums.set(key, {
          ...existing,
          city: existing.city || eventProducts[0]?.checkpoint || '',
          coverUrl: existing.coverUrl || coverProduct?.thumbnailUrl || null,
          sortTime: Math.max(existing.sortTime, latestProductTime),
          products: eventProducts,
        });
        continue;
      }

      albums.set(key, {
        id: `products-${key}`,
        name: eventName,
        slug: null,
        date: eventProducts[0]?.createdAt || null,
        city: eventProducts[0]?.checkpoint || '',
        description: null,
        coverUrl: coverProduct?.thumbnailUrl || null,
        sortTime: latestProductTime,
        products: eventProducts,
        event: null,
      });
    }

    return Array.from(albums.values()).sort((left, right) => {
      const byDate = right.sortTime - left.sortTime;
      if (byDate !== 0) return byDate;
      return left.name.localeCompare(right.name);
    });
  }, [events, productsByEvent]);

  const cities = React.useMemo(() => (
    Array.from(new Set(publicAlbums.map((album) => album.city).filter(Boolean))).sort()
  ), [publicAlbums]);

  const filteredAlbums = React.useMemo(() => {
    return publicAlbums.filter((album) => {
      const matchesQuery = !normalizedQuery ||
        normalizeEventName(`${album.name} ${album.description || ''} ${album.city}`).includes(normalizedQuery) ||
        album.products.some((product) => normalizeEventName(`${product.name} ${product.bib} ${product.checkpoint}`).includes(normalizedQuery));
      const matchesCity = !cityFilter || album.city === cityFilter;
      const matchesDate = !dateFilter || String(album.date || '').startsWith(dateFilter);
      return matchesQuery && matchesCity && matchesDate;
    });
  }, [cityFilter, dateFilter, normalizedQuery, publicAlbums]);

  React.useEffect(() => {
    if (!photographer) return;
    console.info('[public-photographer] albuns renderizados', {
      photographerId: photographer.id,
      totalAlbums: publicAlbums.length,
      filteredAlbums: filteredAlbums.length,
      covers: publicAlbums.map((album) => ({
        id: album.id,
        name: album.name,
        coverUrl: album.coverUrl || null,
        source: album.event?.bannerImage ? 'event.bannerImage' : album.event?.coverImage ? 'event.coverImage' : 'product.thumbnailUrl',
      })),
    });
  }, [filteredAlbums.length, photographer, publicAlbums]);

  const filteredProducts = React.useMemo(() => products.filter((product) => {
    const event = events.find((item) => normalizeEventName(item.name) === normalizeEventName(product.event || ''));
    const city = event?.location || event?.checkpoint || product.checkpoint || '';
    const matchesQuery = !normalizedQuery || normalizeEventName(`${product.name} ${product.event} ${product.bib} ${product.checkpoint}`).includes(normalizedQuery);
    const matchesCity = !cityFilter || city === cityFilter;
    const matchesDate = !dateFilter || String(event?.date || product.createdAt || '').startsWith(dateFilter);
    return matchesQuery && matchesCity && matchesDate;
  }), [cityFilter, dateFilter, events, normalizedQuery, products]);

  if (isLoading) {
    return <PublicLoading label="Carregando perfil do fotografo..." />;
  }

  if (!photographer) {
    return <PublicEmpty title="Fotografo nao encontrado" actionLabel="Voltar para eventos" onAction={() => navigate('/eventos')} />;
  }

  const displayName = getPhotographerPublicName(photographer);
  const profilePhoto = photographer.profilePhoto || photographer.avatar;
  const coverPhoto = photographer.coverPhoto || products.find((product) => product.thumbnailUrl)?.thumbnailUrl || profilePhoto;
  const instagramHandle = photographer.instagram?.replace(/^@/, '').trim();
  const instagramUrl = instagramHandle ? `https://instagram.com/${encodeURIComponent(instagramHandle)}` : '';
  const photoCount = products.filter((product) => product.type === 'IMG').length;

  return (
    <main>
      <section className="relative min-h-[62vh] overflow-hidden border-b-4 border-brutal-black bg-[#111827] text-white">
        {coverPhoto ? (
          <img src={coverPhoto} alt={displayName} className="absolute inset-0 h-full w-full object-cover opacity-50" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,77,0,0.30),transparent_30%),radial-gradient(circle_at_78%_15%,rgba(255,255,255,0.18),transparent_22%),linear-gradient(135deg,#111827_0%,#05080d_55%,#1f2937_100%)]" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-brutal-black via-brutal-black/70 to-brutal-black/25" />
        <div className="relative mx-auto flex min-h-[62vh] max-w-350 flex-col justify-end px-4 py-10 md:px-6 md:py-16">
          <div className="grid gap-7 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)] md:items-end lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="h-44 w-44 overflow-hidden brutal-border border-white bg-white shadow-2xl md:h-60 md:w-60 lg:h-72 lg:w-72">
              {profilePhoto ? (
                <img src={profilePhoto} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100">
                  <UserCircle className="h-28 w-28 text-gray-300 md:h-36 md:w-36" />
                </div>
              )}
            </div>
            <div className="max-w-5xl">
              <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/80 md:text-xs">
                {photographer.verified && <span className="inline-flex min-h-9 items-center gap-2 bg-brutal-accent px-3 py-2 text-white brutal-border"><CheckCircle2 className="h-4 w-4" /> Verificado</span>}
                {photographer.city && <span className="inline-flex min-h-9 items-center gap-2 bg-white/10 px-3 py-2 backdrop-blur-sm brutal-border border-white/40"><MapPin className="h-4 w-4 text-brutal-accent" />{photographer.city}</span>}
                {instagramUrl && (
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-2 bg-white/10 px-3 py-2 backdrop-blur-sm transition-colors brutal-border border-white/40 hover:bg-white hover:text-brutal-black"
                  >
                    <Instagram className="h-4 w-4 text-brutal-accent" />
                    @{instagramHandle}
                  </a>
                )}
              </div>
              <h1 className="font-display text-[clamp(3.25rem,10vw,8rem)] uppercase leading-[0.86] tracking-normal wrap-break-word">{displayName}</h1>
              {photographer.displayName && photographer.displayName !== photographer.name && <p className="mt-3 font-mono text-sm uppercase tracking-widest text-white/70">{photographer.name}</p>}
              {photographer.bio && <p className="mt-5 max-w-4xl font-sans text-base leading-relaxed text-white/90 md:text-xl">{photographer.bio}</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-350 px-4 py-8 md:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <PublicStat icon={<CalendarDays className="h-5 w-5" />} label="Eventos" value={publicAlbums.length} />
          <PublicStat icon={<Camera className="h-5 w-5" />} label="Fotos" value={photoCount} />
          <PublicStat icon={<ImageIcon className="h-5 w-5" />} label="Midias" value={products.length} />
        </div>

        <div className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_180px_auto]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar fotografo, evento, cidade ou numero de peito" className="h-13 w-full brutal-border bg-white pl-12 pr-4 font-mono text-xs uppercase tracking-widest outline-none focus:border-brutal-accent" />
          </label>
          <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} className="h-13 brutal-border bg-white px-4 font-mono text-xs uppercase tracking-widest outline-none">
            <option value="">Todas as cidades</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-13 brutal-border bg-white px-4 font-mono text-xs uppercase tracking-widest outline-none" />
          <div className="flex h-13 brutal-border overflow-hidden bg-white">
            <button type="button" onClick={() => setActiveView('events')} className={`px-4 font-mono text-xs uppercase ${activeView === 'events' ? 'bg-brutal-black text-white' : 'text-brutal-black'}`}>Eventos</button>
            <button type="button" onClick={() => setActiveView('photos')} className={`px-4 font-mono text-xs uppercase ${activeView === 'photos' ? 'bg-brutal-black text-white' : 'text-brutal-black'}`}>Fotos</button>
          </div>
        </div>
      </section>

      {activeView === 'events' ? (
        <section className="mx-auto max-w-300 px-4 pb-16 md:px-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAlbums.map((album) => {
              const photoTotal = album.products.filter((product) => product.type === 'IMG').length;
              const destination = album.slug ? `/evento/${album.slug}` : `/eventos/${createEventSlug(album.name)}`;
              return (
                <button key={album.id} type="button" onClick={() => navigate(destination)} className="group flex h-[29rem] flex-col overflow-hidden bg-white text-left brutal-border brutal-shadow-hover sm:h-[30rem]">
                  <div className="h-48 shrink-0 border-b-2 border-brutal-black bg-gray-100 lg:h-52">
                    {album.coverUrl ? <img src={album.coverUrl} alt={album.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center"><CalendarDays className="h-14 w-14 text-gray-300" /></div>}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-gray-500">{formatPublicDate(album.date)}</p>
                    <h2 className="min-h-[4.5rem] font-display text-xl uppercase leading-tight">{album.name}</h2>
                    <p className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-gray-500"><MapPin className="h-3.5 w-3.5 text-brutal-accent" />{album.city || 'Local a confirmar'}</p>
                    <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-4 font-mono text-[10px] uppercase tracking-widest">
                      <span>{photoTotal} fotos</span>
                      <span className="font-display text-sm text-brutal-accent">Ver Fotos</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredAlbums.length === 0 && (
            <PublicEmpty title={publicAlbums.length === 0 ? 'Este fotografo ainda nao publicou nenhum evento.' : 'Nenhum evento encontrado para estes filtros.'} />
          )}
        </section>
      ) : (
        <PhotoGrid
          title="Fotos do fotografo"
          subtitle={`${filteredProducts.length} midias encontradas no perfil de ${displayName}`}
          photos={filteredProducts.filter((product) => product.type === 'IMG')}
          onAddToCart={onAddToCart}
          cartItems={cartItems}
          favoriteIds={new Set(favoriteProducts.map((item) => item.id))}
          likedIds={likedProductIds}
          heartCounts={heartCounts}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </main>
  );
}

function PublicEventPage({
  slug,
  cartItems,
  favoriteProducts,
  likedProductIds,
  heartCounts,
  onAddToCart,
  onToggleFavorite,
}: PublicPageCartProps & { slug: string }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [event, setEvent] = React.useState<Event | null>(null);
  const [photographer, setPhotographer] = React.useState<Photographer | null>(null);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeView, setActiveView] = React.useState<'photos' | 'videos'>('photos');
  const [isFaceSearchOpen, setIsFaceSearchOpen] = React.useState(false);
  const [faceMatches, setFaceMatches] = React.useState<FaceSearchMatch[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadPublicEvent() {
      setIsLoading(true);
      try {
        const eventRow = await eventService.getEventBySlug(slug);
        if (!eventRow) {
          if (!cancelled) setEvent(null);
          return;
        }
        const [owner, ownerProducts] = await Promise.all([
          eventRow.photographerId ? photographerService.getPhotographerById(eventRow.photographerId) : Promise.resolve(null),
          productService.getPublishedProductsByEvent(eventRow.id, eventRow.name, eventRow.photographerId, storefrontProductLimit),
        ]);
        if (cancelled) return;
        setEvent(eventRow);
        setPhotographer(owner);
        setProducts(ownerProducts);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadPublicEvent().catch((error) => {
      console.error('Erro ao carregar evento publico:', error);
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  React.useEffect(() => {
    if (!event) return;
    const title = `${event.name} | Fotos Funpace Media`;
    const description = event.description || `Fotos do evento ${event.name} na Funpace Media.`;
    document.title = title;
    setMetaTag('meta[name="description"]', { name: 'description' }, description);
    setMetaTag('meta[property="og:title"]', { property: 'og:title' }, title);
    setMetaTag('meta[property="og:description"]', { property: 'og:description' }, description);
    setMetaTag('meta[property="og:url"]', { property: 'og:url' }, window.location.href);
    setMetaTag('meta[property="og:type"]', { property: 'og:type' }, 'article');
    const ogImage = event.bannerImage || event.coverImage;
    if (ogImage) setMetaTag('meta[property="og:image"]', { property: 'og:image' }, ogImage);
  }, [event]);

  if (isLoading) return <PublicLoading label="Carregando evento..." />;
  if (!event) return <PublicEmpty title="Evento nao encontrado" actionLabel="Voltar para eventos" onAction={() => navigate('/eventos')} />;

  const allPhotos = products.filter((product) => product.type === 'IMG');
  const photos = faceMatches ? faceMatches.map((match) => match.product).filter((product) => product.type === 'IMG') : allPhotos;
  const videos = products.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW');
  const cover = event.bannerImage || event.coverImage || products.find((product) => product.thumbnailUrl)?.thumbnailUrl || '';
  const checkpoints = new Set(products.map((product) => product.checkpoint).filter(Boolean)).size;
  const eventCategory = event.status === 'scheduled' ? 'Proximo evento' : event.status === 'closed' ? 'Evento encerrado' : 'Evento esportivo';

  return (
    <main className="bg-[#f4f4f2]">
      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-350 px-4 py-4 md:px-6 md:py-6">
          <button
            type="button"
            onClick={() => navigate(photographer?.username || photographer?.slug ? `/${photographer.username || photographer.slug}` : '/eventos')}
            className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 transition-colors hover:text-brutal-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </button>

          <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_18px_55px_rgba(5,5,5,0.10)]">
            <div className="grid lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.5fr)]">
              <div className="relative min-h-55 overflow-hidden bg-brutal-black sm:min-h-72 lg:min-h-full">
                {cover ? (
                  <img src={cover} alt={event.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 hover:scale-[1.02]" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-white/30"><ImageIcon className="h-16 w-16" /></div>
                )}
                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
                <span className="absolute left-4 top-4 rounded-full bg-brutal-accent px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white shadow-lg">{eventCategory}</span>
              </div>

              <div className="flex min-w-0 flex-col p-5 sm:p-6 lg:p-7">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-brutal-accent">Evento Funpace Media</p>
                    <h1 className="mt-2 max-w-4xl font-display text-[clamp(2rem,4vw,4.25rem)] uppercase leading-[0.92] tracking-normal wrap-break-word">{event.name}</h1>
                    {event.description && <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-relaxed text-gray-600">{event.description}</p>}
                  </div>
                  {photographer && (
                    <div className="shrink-0 rounded-xl bg-brutal-black px-4 py-3 text-white shadow-md">
                      <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-white/50">Fotografo</p>
                      <p className="mt-1 font-display text-sm uppercase">{getPhotographerPublicName(photographer)}</p>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-x-6 gap-y-3 border-y border-black/10 py-4 sm:grid-cols-2 xl:grid-cols-4">
                  <EventMeta icon={<CalendarDays className="h-4 w-4" />} label="Data" value={formatPublicDate(event.date)} />
                  <EventMeta icon={<MapPin className="h-4 w-4" />} label="Cidade / Local" value={event.location || event.checkpoint || 'Local a confirmar'} />
                  <EventMeta icon={<Camera className="h-4 w-4" />} label="Categoria" value={eventCategory} />
                  <EventMeta icon={<Clock3 className="h-4 w-4" />} label="Expiracao" value="Sem data definida" />
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(310px,0.9fr)]">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <EventCompactStat icon={<Images className="h-4 w-4" />} label="Fotos" value={allPhotos.length} />
                    <EventCompactStat icon={<Video className="h-4 w-4" />} label="Videos" value={videos.length} />
                    <EventCompactStat icon={<MapPin className="h-4 w-4" />} label="Pontos" value={checkpoints || 1} />
                  </div>

                  <div className="group rounded-xl border border-black/10 bg-[#fff7d6] p-4 shadow-[0_10px_30px_rgba(5,5,5,0.08)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_35px_rgba(5,5,5,0.13)]">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brutal-black text-brutal-accent transition-transform duration-300 group-hover:scale-105"><ScanFace className="h-5 w-5" /></div>
                      <div>
                        <p className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-gray-500">Reconhecimento facial</p>
                        <h2 className="mt-1 font-display text-lg uppercase leading-tight">Encontre suas fotos com uma selfie</h2>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => setIsFaceSearchOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brutal-accent px-4 font-display text-xs uppercase tracking-wider text-white transition-colors hover:bg-brutal-black">
                        <Scan className="h-4 w-4" /> Tirar selfie
                      </button>
                      <button type="button" onClick={() => setIsFaceSearchOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-black/15 bg-white px-4 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors hover:border-brutal-accent hover:text-brutal-accent">
                        <Upload className="h-4 w-4" /> Carregar foto
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFaceMatches(null);
                        setActiveView('photos');
                      }}
                      className="mt-3 w-full font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-gray-500 transition-colors hover:text-brutal-accent"
                    >
                      {faceMatches ? 'Limpar busca e ver todas as fotos' : 'Ver todas as fotos'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {activeView === 'photos' ? (
        <PhotoGrid
          title={faceMatches ? `Fotos Encontradas (${photos.length})` : 'Fotos do evento'}
          subtitle={faceMatches
            ? photos.length > 0
              ? `Encontramos ${photos.length} ${photos.length === 1 ? 'foto sua' : 'fotos suas'} neste evento`
              : 'Nenhuma foto sua foi encontrada neste evento. Tente utilizar outra selfie.'
            : `${photos.length} fotos publicadas neste evento`}
          photos={photos}
          onAddToCart={onAddToCart}
          cartItems={cartItems}
          activeView={activeView}
          onViewChange={setActiveView}
          favoriteIds={new Set(favoriteProducts.map((item) => item.id))}
          likedIds={likedProductIds}
          heartCounts={heartCounts}
          onToggleFavorite={onToggleFavorite}
          compact
        />
      ) : (
        <VideoGrid
          videos={videos}
          onAddToCart={onAddToCart}
          cartItems={cartItems}
          activeView={activeView}
          onViewChange={setActiveView}
          favoriteIds={new Set(favoriteProducts.map((item) => item.id))}
          likedIds={likedProductIds}
          heartCounts={heartCounts}
          onToggleFavorite={onToggleFavorite}
          compact
        />
      )}
      <FaceSearchModal
        isOpen={isFaceSearchOpen}
        eventName={event.name}
        onClose={() => setIsFaceSearchOpen(false)}
        onSearch={async (file, sessionId) => {
          const matches = await productService.searchByFace(file, event.id, sessionId);
          setFaceMatches(matches);
          setActiveView('photos');
          if (matches.length === 0) {
            showToast('Nenhuma foto sua foi encontrada neste evento. Tente utilizar outra selfie.', 'info');
          }
          return matches;
        }}
      />
    </main>
  );
}

function EventMeta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-brutal-accent">{icon}</div>
      <div className="min-w-0">
        <p className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-gray-400">{label}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-gray-800" title={value}>{value}</p>
      </div>
    </div>
  );
}

function EventCompactStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/10 bg-gray-50 p-3 transition-colors hover:border-brutal-accent/60 hover:bg-white">
      <div className="flex items-center gap-2 text-brutal-accent">{icon}<span className="font-mono text-[8px] font-bold uppercase tracking-widest text-gray-500">{label}</span></div>
      <p className="mt-2 font-display text-2xl leading-none">{value}</p>
    </div>
  );
}

function PublicStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white brutal-border p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gray-400">{label}</p>
          <p className="mt-3 font-display text-5xl leading-none text-brutal-black md:text-6xl">{value}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-brutal-black bg-brutal-accent text-white">
          {icon}
        </div>
      </div>
    </div>
  );
}

function PublicLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center py-20">
      <Loader2 className="mb-4 h-12 w-12 animate-spin text-brutal-accent" />
      <p className="font-mono text-sm uppercase tracking-widest text-gray-500">{label}</p>
    </div>
  );
}

function PublicEmpty({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mx-auto max-w-350 px-4 py-20 text-center md:px-6">
      <div className="bg-white brutal-border p-10">
        <p className="font-display text-3xl uppercase text-gray-400">{title}</p>
        {actionLabel && onAction && <button type="button" onClick={onAction} className="mt-6 bg-brutal-black px-6 py-3 font-mono text-xs uppercase tracking-widest text-white brutal-border">{actionLabel}</button>}
      </div>
    </div>
  );
}

function FloatingWhatsappSupport() {
  return (
    <a
      href={buildWhatsappUrl('Ola, Funpace. Preciso de suporte.')}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir suporte no WhatsApp"
      className="fixed bottom-5 right-5 z-70 inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-brutal-black bg-[#25D366] text-brutal-black brutal-shadow transition-transform hover:-translate-y-0.5 hover:bg-[#20bd5a] focus:outline-none focus:ring-4 focus:ring-[#25D366]/30 sm:bottom-6 sm:right-6"
    >
      <MessageCircle className="h-6 w-6" />
    </a>
  );
}

function PaymentNoticeModal({
  notice,
  onClose,
  onOpenOrders,
}: {
  notice: { status: 'paid' | 'pending' | 'cancelled' | 'canceled'; orderId?: string | null; message: string } | null;
  onClose: () => void;
  onOpenOrders: () => void;
}) {
  return (
    <AnimatePresence>
      {notice && (
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
                <h2 className="max-w-full font-display text-[clamp(1.875rem,9vw,2.75rem)] uppercase tracking-normal leading-[0.95] wrap-break-word">
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
      )}
    </AnimatePresence>
  );
}

function CustomerOrdersRoute() {
  const location = useLocation();
  return <Navigate to={`/minha-conta${location.search}`} replace />;
}

function LegacyCustomerOrdersRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [cart, setCart] = useState<Product[]>(() => loadStoredCart());
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>(() => loadFavoriteProducts());
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  React.useEffect(() => {
    const validCart = cart.filter((item) => isValidCartProductId(item.id));
    if (validCart.length !== cart.length) {
      setCart(validCart);
      return;
    }

    localStorage.setItem(cartStorageKey, JSON.stringify(validCart));
  }, [cart]);

  const handleToggleFavorite = (item: Product) => {
    setFavoriteProducts((current) => {
      const exists = current.some((favorite) => favorite.id === item.id);
      const next = exists ? current.filter((favorite) => favorite.id !== item.id) : [item, ...current];
      saveFavoriteProducts(next);
      return next;
    });
  };

  const handleAddToCart = (item: Product) => {
    if (!isValidCartProductId(item.id)) {
      alert('Esta midia precisa ser publicada novamente antes de ir para o checkout.');
      return;
    }

    if (!cart.some((cartItem) => cartItem.id === item.id)) {
      setCart((current) => [...current, item]);
      setIsCartOpen(true);
    }
  };

  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const status = params.get('status');
    const paymentStatus = status === 'paid' || status === 'pending' || status === 'cancelled' || status === 'canceled' ? status : null;

  return (
    <div className="min-h-screen bg-brutal-white font-sans text-brutal-black selection:bg-brutal-accent selection:text-white">
      <Navbar
        cartItemCount={cart.length}
        onOpenCart={() => setIsCartOpen(true)}
        onNavigateHome={() => navigate('/')}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSearch={(bib) => navigate(`/?bib=${encodeURIComponent(bib)}`)}
        onOpenDashboard={() => {
          localStorage.setItem('funpace:photographer-panel-active', 'true');
          navigate('/fotografo');
        }}
        onOpenOrders={() => navigate('/minha-conta')}
        onOpenAccount={() => navigate('/minha-conta')}
      />

      <CustomerOrdersPage
        highlightedOrderId={orderId}
        paymentStatus={paymentStatus}
        favoriteProducts={favoriteProducts}
        isAuthenticated={Boolean(user)}
        onLoginRequested={() => setIsAuthOpen(true)}
        onAddToCart={handleAddToCart}
        onToggleFavorite={handleToggleFavorite}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cart}
        onRemoveItem={(id) => setCart((current) => current.filter((item) => item.id !== id))}
        isAuthenticated={Boolean(user)}
        onLoginRequested={() => setIsAuthOpen(true)}
        onOpenCheckout={() => {
          setIsCartOpen(false);
          navigate('/checkout');
        }}
      />

      <AnimatePresence>
        {isAuthOpen && (
          <AuthView
            onClose={() => setIsAuthOpen(false)}
            onSuccess={() => setIsAuthOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CustomerAccountRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Product[]>(() => loadStoredCart());
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>(() => loadFavoriteProducts());
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  React.useEffect(() => {
    const validCart = cart.filter((item) => isValidCartProductId(item.id));
    if (validCart.length !== cart.length) {
      setCart(validCart);
      return;
    }

    localStorage.setItem(cartStorageKey, JSON.stringify(validCart));
  }, [cart]);

  React.useEffect(() => {
    if (!user) setIsAuthOpen(true);
  }, [user]);

  const handleAddToCart = (item: Product) => {
    if (!isValidCartProductId(item.id)) {
      alert('Esta midia precisa ser publicada novamente antes de ir para o checkout.');
      return;
    }

    setCart((current) => current.some((cartItem) => cartItem.id === item.id) ? current : [...current, item]);
    setIsCartOpen(true);
  };

  const handleToggleFavorite = (item: Product) => {
    setFavoriteProducts((current) => {
      const exists = current.some((favorite) => favorite.id === item.id);
      const next = exists ? current.filter((favorite) => favorite.id !== item.id) : [item, ...current];
      saveFavoriteProducts(next);
      customerAccountService.setFavorite(item, !exists).catch(() => undefined);
      return next;
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-brutal-white font-sans text-brutal-black">
        <Navbar
          cartItemCount={cart.length}
          onOpenCart={() => setIsCartOpen(true)}
          onNavigateHome={() => navigate('/')}
          onOpenAuth={() => setIsAuthOpen(true)}
          onSearch={(bib) => navigate(`/?bib=${encodeURIComponent(bib)}`)}
          onOpenDashboard={() => navigate('/fotografo')}
          onOpenOrders={() => navigate('/minha-conta')}
          onOpenAccount={() => navigate('/minha-conta')}
        />
        <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
          <UserCircle className="mb-4 h-16 w-16 text-gray-300" />
          <h1 className="font-display text-4xl uppercase">Entre para acessar</h1>
          <p className="mt-3 font-mono text-xs uppercase leading-relaxed text-gray-500">Sua conta reune pedidos, downloads e favoritos.</p>
          <button onClick={() => setIsAuthOpen(true)} className="mt-6 min-h-12 bg-brutal-black px-6 text-white brutal-border font-display text-sm uppercase tracking-widest hover:bg-brutal-accent">
            Entrar / cadastrar
          </button>
        </div>
        <AnimatePresence>
          {isAuthOpen && <AuthView onClose={() => setIsAuthOpen(false)} onSuccess={() => setIsAuthOpen(false)} />}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brutal-white font-sans text-brutal-black">
      <Navbar
        cartItemCount={cart.length}
        onOpenCart={() => setIsCartOpen(true)}
        onNavigateHome={() => navigate('/')}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSearch={(bib) => navigate(`/?bib=${encodeURIComponent(bib)}`)}
        onOpenDashboard={() => navigate('/fotografo')}
        onOpenOrders={() => navigate('/minha-conta')}
        onOpenAccount={() => navigate('/minha-conta')}
      />

      <CustomerAccountPage
        favoriteProducts={favoriteProducts}
        onAddToCart={handleAddToCart}
        onToggleFavorite={handleToggleFavorite}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cart}
        onRemoveItem={(id) => setCart((current) => current.filter((item) => item.id !== id))}
        isAuthenticated={Boolean(user)}
        onLoginRequested={() => setIsAuthOpen(true)}
        onOpenCheckout={() => {
          setIsCartOpen(false);
          navigate('/checkout');
        }}
      />
    </div>
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
          clearStoredSession('customer');
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
    clearStoredSession('customer');
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentEvents, setPaymentEvents] = useState<PaymentEventLog[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminActivityLog[]>([]);
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
      let allPhotographers: Photographer[] = [];
      let allProducts: Product[] = [];
      let allOrders: Order[] = [];
      let allWithdrawals: WithdrawalRequest[] = [];
      let platformSettings = { platformFeePercent: 30 };
      let allCustomers: Customer[] = [];
      let allPayments: PaymentRecord[] = [];
      let allPaymentEvents: PaymentEventLog[] = [];
      let allCoupons: Coupon[] = [];
      let allAdminLogs: AdminActivityLog[] = [];

      try {
        const snapshot = await adminService.getSnapshot();
        allPhotographers = snapshot.photographers;
        allProducts = snapshot.products;
        allOrders = snapshot.orders;
        allWithdrawals = snapshot.withdrawals;
        platformSettings = snapshot.platformSettings;
        allCustomers = snapshot.customers;
        allPayments = snapshot.payments;
        allPaymentEvents = snapshot.paymentEvents;
        allCoupons = snapshot.coupons;
        allAdminLogs = snapshot.adminLogs;
      } catch (snapshotError) {
        console.warn('Snapshot admin indisponivel; usando carregamento por tabela.', snapshotError);
        const recover = async <T,>(label: string, promise: Promise<T>, fallback: T) => {
          try {
            return await promise;
          } catch (error) {
            console.error(`Erro ao carregar ${label}:`, error);
            return fallback;
          }
        };

        [
          allPhotographers,
          allProducts,
          allOrders,
          allWithdrawals,
          platformSettings,
          allCustomers,
          allPayments,
          allPaymentEvents,
          allCoupons,
          allAdminLogs,
        ] = await Promise.all([
          recover('fotografos', photographerService.getAllPhotographers(), []),
          recover('produtos', productService.getAdminProducts(10000), []),
          recover('pedidos', orderService.getAdminOrders(5000), []),
          recover('saques', withdrawalService.getAdminWithdrawals(5000), []),
          recover('configuracoes', platformSettingsService.getPublicSettings(), { platformFeePercent: 30 }),
          recover('clientes', adminService.getCustomers(5000), []),
          recover('pagamentos', adminService.getPayments(5000), []),
          recover('eventos de pagamento', adminService.getPaymentEvents(5000), []),
          recover('cupons', adminService.getCoupons(1000), []),
          recover('logs admin', adminService.getAdminLogs(5000), []),
        ]);
      }

      // Compute photographer stats from real data to avoid relying on stored `photographers.stats` (which may be stale).
      const publishedProducts = allProducts.filter((product) => (product.status ?? 'published') === 'published');
      const activeProducts = allProducts.filter((product) => (product.status ?? 'published') !== 'removed');
      const publishedProductIds = new Set(publishedProducts.map((product) => product.id));
      const itemsByPhotographer = new Map<string, { photos: number; videos: number; orders: Set<string>; revenue: number }>();
      for (const product of publishedProducts) {
        const entry = itemsByPhotographer.get(product.vendedorId) ?? { photos: 0, videos: 0, orders: new Set<string>(), revenue: 0 };
        if (product.type === 'IMG') entry.photos += 1;
        if (product.type === 'VIDEO' || product.type === 'VIEW') entry.videos += 1;
        itemsByPhotographer.set(product.vendedorId, entry);
      }
      for (const order of allOrders) {
        if (order.status !== 'paid') continue;
        for (const item of order.items ?? []) {
          if (!publishedProductIds.has(item.productId)) continue;
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
      setCustomers(allCustomers);
      setPayments(allPayments);
      setPaymentEvents(allPaymentEvents);
      setCoupons(allCoupons);
      setAdminLogs(allAdminLogs);
      setMetrics({
        grossRevenue,
        platformFee: grossRevenue * platformFeeRate,
        paidOrders: paidOrders.length,
        pendingOrders: pendingOrders.length,
        totalOrders: allOrders.length,
        totalProducts: publishedProducts.length,
        publishedProducts: publishedProducts.length,
        removedProducts: removedProducts.length,
        photoCount: publishedProducts.filter((product) => product.type === 'IMG').length,
        videoCount: publishedProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
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
      customers={customers}
      payments={payments}
      paymentEvents={paymentEvents}
      coupons={coupons}
      adminLogs={adminLogs}
      metrics={metrics}
      onLogout={handleAdminLogout}
      onRefresh={loadData}
    />
  );
}

export default function App() {
  return (
    <Router>
      <AuthRouteSync />
      <ScrollToTop />
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="/fotografo/definir-senha" element={<PhotographerPasswordSetup />} />
          <Route path="/fotografo/:slug" element={<Storefront />} />
          <Route path="/fotografo" element={<PhotographerRoute />} />
          <Route path="/checkout" element={<Storefront />} />
          <Route path="/minha-conta" element={<CustomerAccountRoute />} />
          <Route path="/minhas-compras" element={<CustomerOrdersRoute />} />
          <Route path="/eventos" element={<Storefront />} />
          <Route path="/eventos/:slug" element={<Storefront />} />
          <Route path="/evento/:slug" element={<Storefront />} />
          <Route path="/para-fotografos" element={<ParaFotografos />} />
          <Route path="/precos" element={<Precos />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/contato" element={<Contato />} />
          <Route path="/termos" element={<Termos />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/pagar" element={<PagamentoSucesso />} />
          <Route path="/pagamento/sucesso" element={<PagamentoSucesso />} />
          <Route path="/" element={<Storefront />} />
          <Route path="/@:slug" element={<Storefront />} />
          <Route path="/:slug" element={<Storefront />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </Router>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-brutal-black flex flex-col items-center justify-center p-6 text-white">
      <Loader2 className="w-10 h-10 text-brutal-accent animate-spin mb-4" />
      <p className="font-mono text-xs uppercase tracking-widest text-gray-400">Carregando...</p>
    </div>
  );
}

function AuthRouteSync() {
  const location = useLocation();

  React.useEffect(() => {
    window.dispatchEvent(new Event('supabase-auth-changed'));
  }, [location.pathname]);

  return null;
}

function ScrollToTop() {
  const location = useLocation();

  React.useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return null;
}

