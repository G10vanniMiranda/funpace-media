import {
  Product,
  Event,
  Photographer,
  Order,
  OrderItem,
  PlatformSettings,
  PhotographerDashboardMetrics,
  PhotographerProductPerformance,
  PhotographerSale,
  WithdrawalRequest,
  Buyer,
} from '../types';
import { MOCK_PHOTOGRAPHERS, MOCK_PHOTOS, MOCK_VIDEOS } from '../data';
import { isMockMode } from './config';
import { getCurrentAccessToken, getCurrentUser, supabaseRest } from './supabase';

type SupabaseRow<T> = T & { id: string };

const selectAll = 'select=*';
let mockProducts = [...MOCK_PHOTOS, ...MOCK_VIDEOS];
let mockPhotographers = [...MOCK_PHOTOGRAPHERS];
const localEventsStorageKey = 'funpace:local-events:v1';

function isMissingEventsTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('public.events') ||
    message.includes("Could not find the table") ||
    message.includes('PGRST205');
}

function loadLocalEvents(): Event[] {
  try {
    const raw = localStorage.getItem(localEventsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Event[] : [];
  } catch {
    return [];
  }
}

function saveLocalEvents(events: Event[]) {
  localStorage.setItem(localEventsStorageKey, JSON.stringify(events));
}

function sortEvents(events: Event[]) {
  return [...events].sort((left, right) => {
    const byDate = String(left.date || '').localeCompare(String(right.date || ''));
    if (byDate !== 0) return byDate;
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
  });
}

function createPublicMediaUrl(rawPathOrUrl?: string | null) {
  const value = rawPathOrUrl || '';
  if (!value || /^https?:\/\//i.test(value)) return value;

  const mediaBaseUrl = import.meta.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${String(mediaBaseUrl).replace(/\/+$/, '')}/${encodeURI(value.replace(/^\/+/, ''))}`;
  }

  return value;
}

function mediaPathKey(value?: string | null) {
  return value || '';
}

async function signMediaUrls<T extends { url?: string; thumbnailUrl?: string | null }>(items: T[]): Promise<T[]> {
  if (isMockMode || items.length === 0) return items;

  const withPublicFallback = () => items.map((item) => ({
    ...item,
    url: createPublicMediaUrl(item.url),
    thumbnailUrl: item.thumbnailUrl ? createPublicMediaUrl(item.thumbnailUrl) : item.thumbnailUrl,
  }));

  const paths = Array.from(new Set(items.flatMap((item) => {
    const thumbnail = mediaPathKey(item.thumbnailUrl);
    return [
      thumbnail,
      thumbnail ? '' : mediaPathKey(item.url),
    ];
  }).filter(Boolean)));

  if (paths.length === 0) return items;

  try {
    const response = await fetch('/api/media/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });

    if (response.status === 404 || response.status === 405) {
      console.warn('/api/media/sign indisponivel neste deploy; usando URLs originais das midias.');
      return withPublicFallback();
    }

    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json() as { urls?: Record<string, string> };
    const urls = payload.urls ?? {};

    return items.map((item) => ({
      ...item,
      url: item.url && urls[item.url] ? urls[item.url] : item.url,
      thumbnailUrl: item.thumbnailUrl && urls[item.thumbnailUrl] ? urls[item.thumbnailUrl] : item.thumbnailUrl,
    }));
  } catch (error) {
    console.error('Erro ao assinar URLs de midia:', error);
    return withPublicFallback();
  }
}

async function uploadMediaFile(path: string, file: File) {
  const accessToken = await getCurrentAccessToken();
  if (!accessToken) {
    throw new Error('Sessao de fotografo ausente. Entre novamente no painel para enviar arquivos.');
  }

  const response = await fetch('/api/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-Storage-Path': encodeURIComponent(path),
    },
    body: file,
  });

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw };
  }

  if (!response.ok) {
    const message = String(payload?.error || payload?.message || raw || `Falha no upload. HTTP ${response.status}`)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    throw new Error(message || `Falha no upload. HTTP ${response.status}`);
  }

  return {
    path: String(payload.path || payload.publicUrl || path),
    publicUrl: String(payload.publicUrl || payload.url || payload.path || ''),
  };
}

function sanitizeStorageFileName(fileName: string) {
  const normalized = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return normalized || 'captura';
}

async function attachOrderItems(orders: SupabaseRow<Order>[], useAuth: boolean): Promise<Order[]> {
  if (orders.length === 0) return orders;

  const orderIds = orders.map((order) => order.id);
  const params = new URLSearchParams({
    select: '*',
    orderId: `in.(${orderIds.join(',')})`,
    order: 'createdAt.asc',
  });
  const items = await supabaseRest.get<SupabaseRow<OrderItem>[]>(`/rest/v1/order_items?${params.toString()}`, useAuth);
  const itemsByOrderId = new Map<string, OrderItem[]>();

  for (const item of items) {
    const orderItems = itemsByOrderId.get(item.orderId) ?? [];
    orderItems.push(item);
    itemsByOrderId.set(item.orderId, orderItems);
  }

  const signedItems = await signMediaUrls(items);
  const signedItemsByOrderId = new Map<string, OrderItem[]>();

  for (const item of signedItems) {
    const orderItems = signedItemsByOrderId.get(item.orderId) ?? [];
    orderItems.push(item);
    signedItemsByOrderId.set(item.orderId, orderItems);
  }

  return orders.map((order) => ({
    ...order,
    items: signedItemsByOrderId.get(order.id) ?? itemsByOrderId.get(order.id) ?? [],
  }));
}

export const productService = {
  async getLatestProducts(count = 20): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.filter((product) => (product.status ?? 'published') === 'published').slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      status: 'eq.published',
      order: 'createdAt.desc',
      limit: String(count),
    });
    const products = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`);
    return signMediaUrls(products);
  },

  async getAdminProducts(count = 1000): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    const products = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
    return signMediaUrls(products);
  },

  async searchByBib(bib: string): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.filter((product) => product.bib === bib && (product.status ?? 'published') === 'published');
    }

    const params = new URLSearchParams({
      select: '*',
      bib: `eq.${bib}`,
      status: 'eq.published',
    });
    const products = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`);
    return signMediaUrls(products);
  },

  async getVendedorProducts(vendedorId: string): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.filter((product) => product.vendedorId === vendedorId);
    }

    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
    });
    const products = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
    return signMediaUrls(products);
  },

  async addProduct(product: Omit<Product, 'id'>): Promise<string> {
    if (isMockMode) {
      const id = `mock-${crypto.randomUUID()}`;
      mockProducts = [{ id, ...product }, ...mockProducts];
      return id;
    }

    const [created] = await supabaseRest.post<SupabaseRow<Product>[]>(
      `/rest/v1/products?${selectAll}`,
      {
        ...product,
        status: product.status ?? 'published',
        createdAt: new Date().toISOString(),
      },
      true,
    );

    return created.id;
  },

  async updateProduct(id: string, product: Pick<Product, 'name' | 'price' | 'event' | 'checkpoint' | 'bib' | 'status'>): Promise<Product> {
    if (isMockMode) {
      const existingProduct = mockProducts.find((item) => item.id === id);
      if (!existingProduct) throw new Error('Produto nao encontrado.');

      const updatedProduct = { ...existingProduct, ...product };
      mockProducts = mockProducts.map((item) => (item.id === id ? updatedProduct : item));
      return updatedProduct;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      product,
      true,
    );

    if (!updated) throw new Error('Produto nao encontrado.');
    return updated;
  },

  async updateProductThumbnail(id: string, thumbnailUrl: string): Promise<Product> {
    if (isMockMode) {
      const existingProduct = mockProducts.find((item) => item.id === id);
      if (!existingProduct) throw new Error('Produto nao encontrado.');

      const updatedProduct = { ...existingProduct, thumbnailUrl };
      mockProducts = mockProducts.map((item) => (item.id === id ? updatedProduct : item));
      return updatedProduct;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      { thumbnailUrl },
      true,
    );

    if (!updated) throw new Error('Produto nao encontrado.');
    return updated;
  },

  async removeProduct(id: string): Promise<Product> {
    if (isMockMode) {
      const existingProduct = mockProducts.find((item) => item.id === id);
      if (!existingProduct) throw new Error('Produto nao encontrado.');

      const updatedProduct = { ...existingProduct, status: 'removed' as const };
      mockProducts = mockProducts.map((item) => (item.id === id ? updatedProduct : item));
      return updatedProduct;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      { status: 'removed' },
      true,
    );

    if (!updated) throw new Error('Produto nao encontrado.');
    return updated;
  },

  async uploadProductFile(vendedorId: string, file: File) {
    if (isMockMode) {
      return {
        path: `mock/${vendedorId}/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    const safeName = sanitizeStorageFileName(file.name);
    const path = `${vendedorId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    return uploadMediaFile(path, file);
  },

  async uploadProductThumbnail(vendedorId: string, file: File) {
    if (isMockMode) {
      return {
        path: `mock/${vendedorId}/thumbs/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    const safeName = sanitizeStorageFileName(file.name);
    const path = `${vendedorId}/thumbs/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    return uploadMediaFile(path, file);
  },
};

export const orderService = {
  async getCustomerOrders(count = 50): Promise<Order[]> {
    if (isMockMode) {
      return [];
    }

    const user = getCurrentUser();
    if (!user?.uid) {
      return [];
    }

    const params = new URLSearchParams({
      select: '*',
      userId: `eq.${user.uid}`,
      order: 'createdAt.desc',
      limit: String(count),
    });
    const orders = await supabaseRest.get<SupabaseRow<Order>[]>(`/rest/v1/orders?${params.toString()}`, true);
    const ownOrders = orders.filter((order) => order.userId === user.uid);
    return attachOrderItems(ownOrders, true);
  },

  async getAdminOrders(count = 200): Promise<Order[]> {
    if (isMockMode) {
      return [];
    }

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    const orders = await supabaseRest.get<SupabaseRow<Order>[]>(`/rest/v1/orders?${params.toString()}`, true);
    return attachOrderItems(orders, true);
  },

  async updateOrderStatus(id: string, status: Order['status']): Promise<Order> {
    if (isMockMode) {
      throw new Error('Atualizacao manual de pedido esta disponivel apenas no modo producao.');
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Order>[]>(
      `/rest/v1/orders?${params.toString()}&${selectAll}`,
      { status },
      true,
    );

    if (!updated) throw new Error('Pedido nao encontrado.');
    return updated;
  },
};

export const eventService = {
  async getEvents(count = 200): Promise<Event[]> {
    if (isMockMode) {
      return [];
    }

    const params = new URLSearchParams({
      select: '*',
      order: 'date.asc,createdAt.desc',
      limit: String(count),
    });
    try {
      const events = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`, true);
      return sortEvents([...events, ...loadLocalEvents()]).slice(0, count);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        console.warn('Tabela public.events ausente no Supabase; usando eventos locais neste navegador.');
        return sortEvents(loadLocalEvents()).slice(0, count);
      }
      throw error;
    }
  },

  async getTodayEvents(): Promise<Event[]> {
    if (isMockMode) {
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      select: '*',
      date: `eq.${today}`,
      status: 'in.(scheduled,active)',
      order: 'createdAt.desc',
      limit: '100',
    });
    try {
      const events = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`, true);
      return events;
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return loadLocalEvents().filter((event) =>
          event.date === today && (event.status === 'scheduled' || event.status === 'active')
        );
      }
      throw error;
    }
  },

  async getActiveEvents(count = 100): Promise<Event[]> {
    if (isMockMode) {
      return [];
    }

    const params = new URLSearchParams({
      select: '*',
      status: 'in.(scheduled,active)',
      order: 'date.asc,createdAt.desc',
      limit: String(count),
    });
    try {
      return supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`, true);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return loadLocalEvents().filter((event) => event.status === 'scheduled' || event.status === 'active');
      }
      throw error;
    }
  },

  async createEvent(input: Pick<Event, 'name' | 'date' | 'location' | 'checkpoint' | 'status'>): Promise<Event> {
    if (isMockMode) {
      return {
        id: `mock-event-${crypto.randomUUID()}`,
        ...input,
        createdAt: new Date().toISOString(),
      };
    }

    const payload = {
      ...input,
      createdAt: new Date().toISOString(),
    };

    try {
      const [created] = await supabaseRest.post<SupabaseRow<Event>[]>(
        `/rest/v1/events?${selectAll}`,
        payload,
        true,
      );

      return created;
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        const created: Event = {
          id: `local-event-${crypto.randomUUID()}`,
          ...payload,
        };
        saveLocalEvents([created, ...loadLocalEvents()]);
        return created;
      }
      throw error;
    }
  },
};

export interface InfinitePayCheckoutItem {
  description: string;
  quantity: number;
  price: number;
}

export interface InfinitePayCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface CreateInfinitePayCheckoutInput {
  userId: string;
  buyer: Buyer;
  items: { id: string }[];
  successUrl: string;
  cancelUrl?: string;
}

export const paymentService = {
  async createInfinitePayCheckout(input: CreateInfinitePayCheckoutInput): Promise<{
    paymentUrl: string;
    orderId: string;
    total: number;
  }> {
    const accessToken = await getCurrentAccessToken();
    const response = await fetch('/api/checkout/create-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(input),
    });

    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw };
    }

    if (!response.ok || !data?.url) {
      const detail = data?.error || data?.message || data?.msg || raw;
      throw new Error(detail ? `Nao foi possivel iniciar o pagamento: ${detail}` : `Nao foi possivel iniciar o pagamento. HTTP ${response.status}`);
    }

    return {
      paymentUrl: data.url,
      orderId: data.orderId,
      total: Number(data.total || 0),
    };
  },
};

export const photographerDashboardService = {
  async getDashboard(vendedorId: string, products: Product[]): Promise<{
    metrics: PhotographerDashboardMetrics;
    recentSales: PhotographerSale[];
    productPerformance: PhotographerProductPerformance[];
  }> {
    const publishedProducts = products.filter((product) => (product.status ?? 'published') === 'published');

    if (isMockMode) {
      const mockSales = mockProducts
        .filter((product) => product.vendedorId === vendedorId)
        .slice(0, 3)
        .map((product, index): PhotographerSale => ({
          id: `mock-sale-${index + 1}`,
          orderId: `mock-order-${index + 1}`,
          productId: product.id,
          name: product.name,
          type: product.type,
          price: product.price,
          url: product.url,
          vendedorId: product.vendedorId,
          bib: product.bib,
          event: product.event,
          checkpoint: product.checkpoint,
          thumbnailUrl: product.thumbnailUrl,
          createdAt: new Date().toISOString(),
          orderCreatedAt: new Date().toISOString(),
          orderStatus: 'paid',
          netAmount: product.price * 0.7,
        }));

      return {
        metrics: {
          totalEarnings: mockSales.reduce((total, sale) => total + sale.netAmount, 0),
          pendingEarnings: mockSales.reduce((total, sale) => total + sale.netAmount, 0),
          salesCount: mockSales.length,
          todaySalesCount: mockSales.length,
          publishedMediaCount: publishedProducts.length,
          photoCount: publishedProducts.filter((product) => product.type === 'IMG').length,
          videoCount: publishedProducts.filter((product) => product.type === 'VIDEO').length,
          rating: mockPhotographers.find((photographer) => photographer.id === vendedorId)?.stats.rating ?? 5,
          downloads: mockSales.length,
          platformFeePercent: 30,
          monthlyEarnings: mockSales.reduce((total, sale) => total + sale.netAmount, 0),
          availableBalance: mockSales.reduce((total, sale) => total + sale.netAmount, 0),
          monthlyGoal: 5000,
        },
        recentSales: mockSales,
        productPerformance: mockSales.map((sale) => ({
          productId: sale.productId,
          name: sale.name,
          type: sale.type,
          event: sale.event,
          bib: sale.bib,
          thumbnailUrl: sale.thumbnailUrl,
          salesCount: 1,
          downloads: 0,
          grossRevenue: sale.price,
          netRevenue: sale.netAmount,
        })),
      };
    }

    const settings = await platformSettingsService.getPublicSettings();
    const feePercent = Number(settings.platformFeePercent);
    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
      order: 'createdAt.desc',
      limit: '200',
    });
    const saleItems = await supabaseRest.get<SupabaseRow<OrderItem>[]>(
      `/rest/v1/order_items?${params.toString()}`,
      true,
    );

    if (saleItems.length === 0) {
      return {
        metrics: {
          totalEarnings: 0,
          pendingEarnings: 0,
          salesCount: 0,
          todaySalesCount: 0,
          publishedMediaCount: publishedProducts.length,
          photoCount: publishedProducts.filter((product) => product.type === 'IMG').length,
          videoCount: publishedProducts.filter((product) => product.type === 'VIDEO').length,
          rating: 5,
          downloads: 0,
          platformFeePercent: feePercent,
          monthlyEarnings: 0,
          availableBalance: 0,
          monthlyGoal: 5000,
        },
        recentSales: [],
        productPerformance: [],
      };
    }

    const orderIds = Array.from(new Set(saleItems.map((item) => item.orderId).filter(Boolean)));
    const orderParams = new URLSearchParams({
      select: 'id,status,createdAt,updatedAt',
      id: `in.(${orderIds.join(',')})`,
    });
    const relatedOrders = await supabaseRest.get<SupabaseRow<Pick<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'>>[]>(
      `/rest/v1/orders?${orderParams.toString()}`,
      true,
    );
    const paidOrderById = new Map(
      relatedOrders
        .filter((order) => order.status === 'paid')
        .map((order) => [order.id, order]),
    );

    const signedSaleItems = await signMediaUrls(saleItems);
    const todayKey = new Date().toISOString().slice(0, 10);
    const paidSales = signedSaleItems
      .filter((item) => paidOrderById.has(item.orderId))
      .map((item): PhotographerSale => {
        const order = paidOrderById.get(item.orderId);
        const netAmount = Number(item.price) * (1 - feePercent / 100);
        return {
          ...item,
          orderCreatedAt: order?.updatedAt ?? order?.createdAt ?? item.createdAt,
          orderStatus: order?.status ?? 'paid',
          netAmount,
        } satisfies PhotographerSale;
      })
      .sort((a, b) => new Date(b.orderCreatedAt).getTime() - new Date(a.orderCreatedAt).getTime());

    const totalEarnings = paidSales.reduce((total, sale) => total + sale.netAmount, 0);
    const releaseWindowMs = 7 * 24 * 60 * 60 * 1000;
    const pendingEarnings = paidSales
      .filter((sale) => Date.now() - new Date(sale.orderCreatedAt).getTime() < releaseWindowMs)
      .reduce((total, sale) => total + sale.netAmount, 0);
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const monthlyEarnings = paidSales
      .filter((sale) => sale.orderCreatedAt.slice(0, 7) === currentMonthKey)
      .reduce((total, sale) => total + sale.netAmount, 0);
    const downloadParams = new URLSearchParams({
      select: 'id,productId',
      vendedorId: `eq.${vendedorId}`,
      limit: '10000',
    });
    const downloadEvents = await supabaseRest.get<{ id: string; productId: string }[]>(
      `/rest/v1/download_events?${downloadParams.toString()}`,
      true,
    );
    const downloadsByProductId = new Map<string, number>();
    for (const event of downloadEvents) {
      downloadsByProductId.set(event.productId, (downloadsByProductId.get(event.productId) ?? 0) + 1);
    }
    const performanceByProductId = new Map<string, PhotographerProductPerformance>();
    for (const sale of paidSales) {
      const current = performanceByProductId.get(sale.productId) ?? {
        productId: sale.productId,
        name: sale.name,
        type: sale.type,
        event: sale.event,
        bib: sale.bib,
        thumbnailUrl: sale.thumbnailUrl,
        salesCount: 0,
        downloads: 0,
        grossRevenue: 0,
        netRevenue: 0,
      };
      current.salesCount += 1;
      current.grossRevenue += Number(sale.price || 0);
      current.netRevenue += Number(sale.netAmount || 0);
      current.downloads = downloadsByProductId.get(sale.productId) ?? 0;
      performanceByProductId.set(sale.productId, current);
    }
    const productPerformance = Array.from(performanceByProductId.values())
      .sort((a, b) => b.netRevenue - a.netRevenue || b.downloads - a.downloads)
      .slice(0, 8);
    const withdrawalParams = new URLSearchParams({
      select: 'amount,status',
      photographerId: `eq.${vendedorId}`,
      status: 'in.(pending,approved,paid)',
      limit: '10000',
    });
    const reservedWithdrawals = await supabaseRest.get<Pick<WithdrawalRequest, 'amount' | 'status'>[]>(
      `/rest/v1/withdrawal_requests?${withdrawalParams.toString()}`,
      true,
    );
    const reservedWithdrawalAmount = reservedWithdrawals.reduce((total, withdrawal) => (
      total + Number(withdrawal.amount || 0)
    ), 0);
    const availableBalance = Math.max(0, totalEarnings - pendingEarnings - reservedWithdrawalAmount);

    return {
      metrics: {
        totalEarnings,
        pendingEarnings,
        salesCount: paidSales.length,
        todaySalesCount: paidSales.filter((sale) => sale.orderCreatedAt.slice(0, 10) === todayKey).length,
        publishedMediaCount: publishedProducts.length,
        photoCount: publishedProducts.filter((product) => product.type === 'IMG').length,
        videoCount: publishedProducts.filter((product) => product.type === 'VIDEO').length,
        rating: 5,
        downloads: downloadEvents.length,
        platformFeePercent: feePercent,
        monthlyEarnings,
        availableBalance,
        monthlyGoal: 5000,
      },
        recentSales: paidSales,
      productPerformance,
    };
  },
};

export const platformSettingsService = {
  async getSettings(): Promise<PlatformSettings> {
    if (isMockMode) {
      return {
        id: 'default',
        platformFeePercent: 30,
        withdrawalFee: 5,
        autoBlockSuspicious: true,
      };
    }

    const params = new URLSearchParams({
      select: '*',
      id: 'eq.default',
      limit: '1',
    });
    const [settings] = await supabaseRest.get<SupabaseRow<PlatformSettings>[]>(
      `/rest/v1/platform_settings?${params.toString()}`,
      true,
    );

    if (!settings) throw new Error('Configuracoes da plataforma nao encontradas.');
    return settings;
  },

  async updateSettings(settings: Pick<PlatformSettings, 'platformFeePercent' | 'withdrawalFee' | 'autoBlockSuspicious'>): Promise<PlatformSettings> {
    if (isMockMode) {
      return { id: 'default', ...settings };
    }

    const params = new URLSearchParams({ id: 'eq.default' });
    const [updated] = await supabaseRest.patch<SupabaseRow<PlatformSettings>[]>(
      `/rest/v1/platform_settings?${params.toString()}&${selectAll}`,
      settings,
      true,
    );

    if (!updated) throw new Error('Configuracoes da plataforma nao encontradas.');
    return updated;
  },

  async getPublicSettings(): Promise<Pick<PlatformSettings, 'platformFeePercent'>> {
    if (isMockMode) {
      return { platformFeePercent: 30 };
    }

    try {
      const settings = await this.getSettings();
      return { platformFeePercent: settings.platformFeePercent };
    } catch {
      return { platformFeePercent: 30 };
    }
  },
};

export const withdrawalService = {
  async getPhotographerWithdrawals(photographerId: string, count = 20): Promise<WithdrawalRequest[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      photographerId: `eq.${photographerId}`,
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<WithdrawalRequest>[]>(
      `/rest/v1/withdrawal_requests?${params.toString()}`,
      true,
    );
  },

  async getAdminWithdrawals(count = 200): Promise<WithdrawalRequest[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<WithdrawalRequest>[]>(
      `/rest/v1/withdrawal_requests?${params.toString()}`,
      true,
    );
  },

  async createWithdrawalRequest(photographerId: string, amount: number, pixKey: string): Promise<WithdrawalRequest> {
    if (isMockMode) {
      return {
        id: `mock-withdrawal-${crypto.randomUUID()}`,
        photographerId,
        amount,
        pixKey,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
    }

    const [created] = await supabaseRest.post<SupabaseRow<WithdrawalRequest>[]>(
      `/rest/v1/withdrawal_requests?${selectAll}`,
      {
        photographerId,
        amount,
        pixKey,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      true,
    );

    if (!created) throw new Error('Nao foi possivel criar a solicitacao de saque.');
    return created;
  },

  async updateWithdrawalStatus(id: string, status: WithdrawalRequest['status'], note?: string): Promise<WithdrawalRequest> {
    if (isMockMode) {
      throw new Error('Atualizacao de saque esta disponivel apenas no modo producao.');
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<WithdrawalRequest>[]>(
      `/rest/v1/withdrawal_requests?${params.toString()}&${selectAll}`,
      {
        status,
        note: note ?? null,
        processedAt: ['paid', 'rejected', 'cancelled'].includes(status) ? new Date().toISOString() : null,
      },
      true,
    );

    if (!updated) throw new Error('Solicitacao de saque nao encontrada.');
    return updated;
  },
};

export const photographerService = {
  async getAllPhotographers(): Promise<Photographer[]> {
    if (isMockMode) {
      return mockPhotographers;
    }

    return supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${selectAll}`, true);
  },

  async getPhotographerById(id: string): Promise<Photographer | null> {
    if (isMockMode) {
      return mockPhotographers.find((photographer) => photographer.id === id) ?? null;
    }

    const params = new URLSearchParams({
      select: '*',
      id: `eq.${id}`,
      limit: '1',
    });
    const rows = await supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${params.toString()}`);
    return rows[0] ?? null;
  },

  async getPhotographerByEmail(email: string): Promise<Photographer | null> {
    if (isMockMode) {
      return mockPhotographers.find((photographer) => photographer.email.toLowerCase() === email.toLowerCase()) ?? null;
    }

    const params = new URLSearchParams({
      select: '*',
      email: `eq.${email}`,
      limit: '1',
    });
    const rows = await supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${params.toString()}`);
    return rows[0] ?? null;
  },

  async addPhotographer(photographer: Omit<Photographer, 'id' | 'verified'>): Promise<string> {
    if (isMockMode) {
      const id = `mock-photographer-${crypto.randomUUID()}`;
      mockPhotographers = [{ id, ...photographer, verified: false }, ...mockPhotographers];
      return id;
    }

    const user = getCurrentUser();
    if (!user?.id || !user.email) {
      throw new Error('Para solicitar cadastro de fotografo, crie uma conta ou entre com Supabase Auth.');
    }

    const [created] = await supabaseRest.post<SupabaseRow<Photographer>[]>(
      `/rest/v1/photographers?${selectAll}`,
      {
        id: user.id,
        ...photographer,
        email: user.email,
        verified: false,
        createdAt: new Date().toISOString(),
      },
      true,
    );

    return created.id;
  },

  async verifyPhotographer(id: string): Promise<void> {
    if (isMockMode) {
      mockPhotographers = mockPhotographers.map((photographer) => (
        photographer.id === id ? { ...photographer, verified: true } : photographer
      ));
      return;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    await supabaseRest.patch(`/rest/v1/photographers?${params.toString()}`, { verified: true }, true);
  },

  async updatePhotographerAdmin(
    id: string,
    changes: Partial<Pick<Photographer, 'name' | 'bio' | 'avatar' | 'phone' | 'cpf' | 'verified'>>,
  ): Promise<Photographer> {
    if (isMockMode) {
      const existing = mockPhotographers.find((photographer) => photographer.id === id);
      if (!existing) throw new Error('Fotografo nao encontrado.');
      const updated = { ...existing, ...changes } as Photographer;
      mockPhotographers = mockPhotographers.map((photographer) => (photographer.id === id ? updated : photographer));
      return updated;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Photographer>[]>(
      `/rest/v1/photographers?${params.toString()}&${selectAll}`,
      changes,
      true,
    );

    if (!updated) throw new Error('Fotografo nao encontrado.');
    return updated;
  },
};
