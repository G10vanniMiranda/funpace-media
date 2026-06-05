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
  Customer,
  PaymentRecord,
  PaymentEventLog,
  PaymentRecoveryIssue,
  Coupon,
  AdminActivityLog,
} from '../types';
import { MOCK_PHOTOGRAPHERS, MOCK_PHOTOS, MOCK_VIDEOS } from '../data';
import { isMockMode } from './config';
import { getCurrentAccessToken, getCurrentUser, supabaseConfig, supabaseRest } from './supabase';
import { FUNPACE_CONTACT_EMAIL } from './contact';

type SupabaseRow<T> = T & { id: string };

const selectAll = 'select=*';
let mockProducts = [...MOCK_PHOTOS, ...MOCK_VIDEOS];
let mockPhotographers = [...MOCK_PHOTOGRAPHERS];
const localEventsStorageKey = 'funpace:local-events:v1';
const defaultUploadLimitBytes = 300 * 1024 * 1024;
const clientUploadLimitBytes = Number(import.meta.env.VITE_MEDIA_UPLOAD_MAX_BYTES || defaultUploadLimitBytes);

function apiUrl(path: string) {
  const baseUrl = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

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

function sortEventsNewestFirst(events: Event[]) {
  return [...events].sort((left, right) => {
    const byDate = String(right.date || '').localeCompare(String(left.date || ''));
    if (byDate !== 0) return byDate;
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
  });
}

function createEventSlug(name: string, date: string) {
  const normalized = `${name}-${date || Date.now()}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `evento-${Date.now()}`;
}

function createPhotographerSlug(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `fotografo-${Date.now()}`;
}

export const reservedPublicSlugs = new Set([
  'admin',
  'api',
  'auth',
  'busca',
  'cadastro',
  'carrinho',
  'checkout',
  'contato',
  'dashboard',
  'evento',
  'eventos',
  'faq',
  'fotografo',
  'login',
  'minha-conta',
  'minhas-compras',
  'pagar',
  'pagamento',
  'para-fotografos',
  'perfil',
  'precos',
  'privacidade',
  'termos',
  'upload',
]);

export function normalizePhotographerUsername(value: string) {
  return createPhotographerSlug(value).slice(0, 80);
}

export function validatePhotographerUsername(value: string) {
  const username = normalizePhotographerUsername(value);
  if (!/^[a-z0-9-]{2,80}$/.test(username)) {
    throw new Error('Use apenas letras, numeros e hifen na URL publica.');
  }
  if (reservedPublicSlugs.has(username)) {
    throw new Error('Esta URL publica e reservada pelo sistema.');
  }
  return username;
}

function isDuplicateSlugError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('events_slug_key') ||
    message.toLowerCase().includes('duplicate key value') && message.toLowerCase().includes('slug');
}

function isMissingEventCoverMediaColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return normalized.includes('covermediaid') &&
    (normalized.includes('schema cache') || normalized.includes('could not find') || normalized.includes('pgrst204'));
}

async function createAvailableEventSlug(name: string, date: string, ignoredEventId?: string) {
  const baseSlug = createEventSlug(name, date);
  const params = new URLSearchParams({
    select: 'id,slug',
    slug: `like.${baseSlug}%`,
    limit: '500',
  });
  const existingEvents = await supabaseRest.get<Array<Pick<Event, 'id' | 'slug'>>>(
    `/rest/v1/events?${params.toString()}`,
    true,
  );
  const usedSlugs = new Set(
    existingEvents
      .filter((event) => event.id !== ignoredEventId)
      .map((event) => event.slug)
      .filter(Boolean),
  );

  if (!usedSlugs.has(baseSlug)) return baseSlug;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!usedSlugs.has(candidate)) return candidate;
  }

  return `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
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

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function quotePostgrestString(value: string) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function postgrestIn(values: string[]) {
  return `in.(${values.map(quotePostgrestString).join(',')})`;
}

async function getPagedRows<T>(
  path: string,
  count: number,
  useAuth = false,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  const safeLimit = Math.max(1, count);
  const safePageSize = Math.max(1, Math.min(pageSize, safeLimit));

  for (let offset = 0; rows.length < safeLimit; offset += safePageSize) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await supabaseRest.get<T[]>(
      `${path}${separator}limit=${safePageSize}&offset=${offset}`,
      useAuth,
    );
    rows.push(...page);
    if (page.length < safePageSize) break;
  }

  return rows.slice(0, safeLimit);
}

function mediaPathKey(value?: string | null) {
  return value || '';
}

async function signMediaUrls<T extends { url?: string; thumbnailUrl?: string | null; type?: string }>(
  items: T[],
  options: { protectImageOriginals?: boolean } = {},
): Promise<T[]> {
  if (isMockMode || items.length === 0) return items;
  const shouldProtectImageOriginal = (item: T) => options.protectImageOriginals && item.type === 'IMG';

  const withPublicFallback = () => items.map((item) => ({
    ...item,
    url: shouldProtectImageOriginal(item) ? '' : createPublicMediaUrl(item.url),
    thumbnailUrl: item.thumbnailUrl ? createPublicMediaUrl(item.thumbnailUrl) : item.thumbnailUrl,
  }));

  const paths = Array.from(new Set(items.flatMap((item) => {
    const thumbnail = mediaPathKey(item.thumbnailUrl);
    const shouldSignOriginal = !shouldProtectImageOriginal(item) && (item.type === 'VIDEO' || item.type === 'VIEW' || !thumbnail);
    return [
      thumbnail,
      shouldSignOriginal ? mediaPathKey(item.url) : '',
    ];
  }).filter(Boolean)));

  if (paths.length === 0) return options.protectImageOriginals ? withPublicFallback() : items;

  try {
    const response = await fetch(apiUrl('/api/media/sign'), {
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
      url: shouldProtectImageOriginal(item) ? '' : item.url && urls[item.url] ? urls[item.url] : item.url,
      thumbnailUrl: item.thumbnailUrl && urls[item.thumbnailUrl] ? urls[item.thumbnailUrl] : item.thumbnailUrl,
    }));
  } catch (error) {
    console.error('Erro ao assinar URLs de midia:', error);
    return withPublicFallback();
  }
}

async function uploadMediaFile(path: string, file: File, metadata?: { fileHash?: string; uploadBatchId?: string }) {
  let accessToken = await getCurrentAccessToken();
  if (!accessToken) {
    throw new Error('Sessao de fotografo ausente. Entre novamente no painel para enviar arquivos.');
  }

  const uploadUrl = apiUrl('/api/media/upload');
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Storage-Path': encodeURIComponent(path),
          ...(metadata?.fileHash ? { 'X-File-Hash': metadata.fileHash } : {}),
          ...(metadata?.uploadBatchId ? { 'X-Upload-Batch-Id': metadata.uploadBatchId } : {}),
        },
        body: file,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error || 'falha de rede');
      const fileSizeMb = Math.ceil(file.size / 1024 / 1024);
      const limitMb = Math.round(clientUploadLimitBytes / 1024 / 1024);
      const likelyProxyDrop = /failed to fetch|networkerror|load failed/i.test(detail);
      const diagnostic = likelyProxyDrop
        ? `O navegador nao recebeu resposta HTTP da API. Isso costuma acontecer quando o proxy/Nginx ativo encerra o upload antes do backend, por limite de corpo ou timeout. Confira o server block ativo de api.funpace.media com client_max_body_size ${limitMb}m, proxy_read_timeout/proxy_send_timeout altos, proxy_request_buffering off e reinicie/reload do Nginx e do backend.`
        : `Verifique o limite do proxy/Nginx, timeout do proxy e se o backend foi reiniciado com MEDIA_UPLOAD_LIMIT=${limitMb}mb.`;
      throw new Error(`Nao foi possivel concluir o upload de ${fileSizeMb} MB em ${uploadUrl}. ${diagnostic} Detalhe: ${detail || 'falha de rede'}`);
    }

    const raw = await response.text();
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw };
    }

    if (!response.ok) {
      const status = response.status;
      const retryAfterSeconds = Number(response.headers.get('Retry-After') || '5');
      if (status === 401 && attempt <= maxRetries) {
        const refreshedToken = await getCurrentAccessToken(true).catch(() => null);
        if (refreshedToken && refreshedToken !== accessToken) {
          accessToken = refreshedToken;
          continue;
        }
      }

      const shouldRetry = [429, 502, 503, 504].includes(status) && attempt <= maxRetries;

      if (shouldRetry) {
        const delayMs = Math.max(1000, retryAfterSeconds * 1000);
        console.warn(`Tentativa ${attempt}/${maxRetries} de upload rate-limited. Repetindo em ${delayMs} ms.`);
        await wait(delayMs + Math.floor(Math.random() * 500));
        continue;
      }

      const message = String(payload?.error || payload?.message || raw || `Falha no upload. HTTP ${status}`)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      throw new Error(message || `Falha no upload. HTTP ${status}`);
    }

    return {
      path: String(payload.path || payload.publicUrl || path),
      publicUrl: String(payload.publicUrl || payload.url || payload.path || ''),
      reused: Boolean(payload.reused),
    };
  }
}

export async function calculateFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

function getSupabaseStoragePublicUrl(bucket: string, path: string) {
  return `${supabaseConfig.url.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

async function uploadSupabaseStorageObject(bucket: string, path: string, file: File) {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    throw new Error('Supabase Storage nao configurado.');
  }

  const accessToken = await getCurrentAccessToken();
  if (!accessToken) {
    throw new Error('Sessao de fotografo ausente. Entre novamente para atualizar o perfil.');
  }

  const response = await fetch(`${supabaseConfig.url.replace(/\/+$/, '')}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'Cache-Control': '31536000',
      'x-upsert': 'true',
    },
    body: file,
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = raw;
    try {
      const payload = raw ? JSON.parse(raw) : {};
      message = payload?.message || payload?.error || raw;
    } catch {
      // Keep raw message.
    }

    if (/bucket not found/i.test(message)) {
      const bucketHint = bucket === 'event-covers'
        ? 'Crie o bucket event-covers no Supabase Storage e aplique scripts/fix-event-cover-schema.sql.'
        : 'Crie os buckets photographer-avatars e photographer-covers no Supabase Storage.';
      throw new Error(`Bucket ${bucket} nao encontrado. ${bucketHint}`);
    }
    if (/row-level security|violates row-level security/i.test(message)) {
      const policyHint = bucket === 'event-covers'
        ? 'Aplique as policies do bucket event-covers em scripts/fix-event-cover-schema.sql.'
        : 'Aplique as policies dos buckets photographer-avatars e photographer-covers.';
      throw new Error(`Upload bloqueado pela politica do Storage. ${policyHint}`);
    }

    throw new Error(message || `Falha no upload para ${bucket}.`);
  }

  return {
    path,
    publicUrl: getSupabaseStoragePublicUrl(bucket, path),
  };
}

async function uploadPhotographerProfileImage(kind: 'avatar' | 'cover', file: File) {
  const accessToken = await getCurrentAccessToken();
  if (!accessToken) {
    throw new Error('Sessao de fotografo ausente. Entre novamente para atualizar o perfil.');
  }

  const response = await fetch(apiUrl('/api/photographers/profile-image'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Profile-Image-Kind': kind,
      'X-File-Name': encodeURIComponent(file.name),
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
    throw new Error(payload?.error || payload?.message || `Falha no upload da imagem. HTTP ${response.status}`);
  }

  if (!payload?.publicUrl) {
    throw new Error('Upload concluido, mas o Storage nao retornou URL publica.');
  }

  return payload as { path: string; publicUrl: string };
}

function normalizeFileName(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function attachOrderItems(orders: SupabaseRow<Order>[], useAuth: boolean): Promise<Order[]> {
  if (orders.length === 0) return orders;

  const orderIds = orders.map((order) => order.id);
  const params = new URLSearchParams({
    select: '*',
    orderId: postgrestIn(orderIds),
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
    });
    const products = await getPagedRows<SupabaseRow<Product>>(`/rest/v1/products?${params.toString()}`, count);
    return signMediaUrls(products, { protectImageOriginals: true });
  },

  async getAdminProducts(count = 1000): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
    });
    const products = await getPagedRows<SupabaseRow<Product>>(`/rest/v1/products?${params.toString()}`, count, true);
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
    return signMediaUrls(products, { protectImageOriginals: true });
  },

  async getVendedorProducts(vendedorId: string): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.filter((product) => product.vendedorId === vendedorId);
    }

    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
      order: 'createdAt.desc',
    });
    const products = await getPagedRows<SupabaseRow<Product>>(`/rest/v1/products?${params.toString()}`, 5000, true);
    return signMediaUrls(products);
  },

  async getPublishedProductsByPhotographer(photographerId: string, count = 5000): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts
        .filter((product) => product.vendedorId === photographerId && (product.status ?? 'published') === 'published')
        .slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${photographerId}`,
      status: 'eq.published',
      order: 'createdAt.desc',
    });
    const products = await getPagedRows<SupabaseRow<Product>>(`/rest/v1/products?${params.toString()}`, count);
    return signMediaUrls(products, { protectImageOriginals: true });
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

  async findExistingProductByFileHash(vendedorId: string, fileHash: string, eventName?: string): Promise<Product | null> {
    if (!fileHash || isMockMode) return null;

    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
      fileHash: `eq.${fileHash}`,
      status: 'neq.removed',
      order: 'createdAt.desc',
      limit: '5',
    });

    try {
      const rows = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
      const normalizedEvent = eventName?.trim().toLowerCase();
      const match = normalizedEvent
        ? rows.find((product) => (product.event || '').trim().toLowerCase() === normalizedEvent) || rows[0]
        : rows[0];
      return match ? (await signMediaUrls([match]))[0] : null;
    } catch (error) {
      if (/fileHash|schema cache|does not exist|column/i.test(String(error instanceof Error ? error.message : error))) {
        console.warn('Campos de deduplicacao ausentes no banco; upload seguira sem consulta por hash.');
        return null;
      }
      throw error;
    }
  },

  async findExistingProductByOriginalFileName(vendedorId: string, originalFileName: string, eventName: string): Promise<Product | null> {
    if (!originalFileName || !eventName || isMockMode) return null;

    const normalizedTarget = normalizeFileName(originalFileName);
    const normalizedEvent = eventName.trim().toLowerCase();
    const baseName = originalFileName.replace(/\.[^.]+$/, '').trim();
    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
      event: `eq.${eventName}`,
      status: 'neq.removed',
      order: 'createdAt.desc',
      limit: '200',
    });

    try {
      const rows = await supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
      const match = rows.find((product) => (
        normalizeFileName(product.originalFileName) === normalizedTarget ||
        normalizeFileName(product.name) === normalizeFileName(baseName)
      ));
      if (match) return (await signMediaUrls([match]))[0];

      return rows.find((product) => (product.event || '').trim().toLowerCase() === normalizedEvent && normalizeFileName(product.name) === normalizeFileName(baseName)) ?? null;
    } catch (error) {
      if (/originalFileName|schema cache|does not exist|column/i.test(String(error instanceof Error ? error.message : error))) {
        console.warn('Campo originalFileName ausente no banco; upload seguira sem deduplicacao por nome.');
        return null;
      }
      throw error;
    }
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

  async replaceProductMedia(id: string, changes: Partial<Pick<Product, 'name' | 'price' | 'url' | 'type' | 'event' | 'checkpoint' | 'bib' | 'thumbnailUrl' | 'watermarkUrl' | 'storagePath' | 'fileHash' | 'fileSize' | 'originalFileName' | 'thumbnailHash' | 'uploadBatchId' | 'status'>>): Promise<Product> {
    if (isMockMode) {
      const existingProduct = mockProducts.find((item) => item.id === id);
      if (!existingProduct) throw new Error('Produto nao encontrado.');
      const updatedProduct = { ...existingProduct, ...changes, updatedAt: new Date().toISOString() } as Product;
      mockProducts = mockProducts.map((item) => (item.id === id ? updatedProduct : item));
      return updatedProduct;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      {
        ...changes,
        updatedAt: new Date().toISOString(),
      },
      true,
    );

    if (!updated) throw new Error('Produto nao encontrado.');
    return updated;
  },

  async logUploadConflictAction(input: { action: 'upload_replace' | 'upload_copy'; productId?: string | null; metadata: Record<string, unknown> }) {
    if (isMockMode) return;
    const user = getCurrentUser();
    const token = getCurrentAccessToken();

    if (token) {
      try {
        const response = await fetch('/api/photographers/upload-log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(input),
        });

        if (response.ok) return;
      } catch (error) {
        console.warn('Endpoint de auditoria de upload indisponivel, tentando Supabase direto:', error);
      }
    }

    await supabaseRest.post('/rest/v1/admin_activity_logs', {
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? null,
      action: input.action,
      targetType: 'product',
      targetId: input.productId ?? null,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    }, true).catch((error) => {
      console.warn('Nao foi possivel registrar auditoria de upload duplicado:', error);
    });
  },

  async renameEventProducts(vendedorId: string, previousEventName: string, nextEventName: string): Promise<Product[]> {
    const previousName = previousEventName.trim();
    const nextName = nextEventName.trim();
    if (!vendedorId || !previousName || !nextName || previousName === nextName) {
      return [];
    }

    if (isMockMode) {
      const updatedProducts: Product[] = [];
      mockProducts = mockProducts.map((item) => {
        if (item.vendedorId !== vendedorId || item.event !== previousName) return item;
        const updatedProduct = { ...item, event: nextName };
        updatedProducts.push(updatedProduct);
        return updatedProduct;
      });
      return updatedProducts;
    }

    const params = new URLSearchParams({
      vendedorId: `eq.${vendedorId}`,
      event: `eq.${previousName}`,
    });
    const updated = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      { event: nextName },
      true,
    );

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

  async updateProductStatus(id: string, status: NonNullable<Product['status']>): Promise<Product> {
    if (isMockMode) {
      const existingProduct = mockProducts.find((item) => item.id === id);
      if (!existingProduct) throw new Error('Produto nao encontrado.');
      const updatedProduct = { ...existingProduct, status };
      mockProducts = mockProducts.map((item) => (item.id === id ? updatedProduct : item));
      return updatedProduct;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Product>[]>(
      `/rest/v1/products?${params.toString()}&${selectAll}`,
      { status },
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

  async uploadProductFile(vendedorId: string, file: File, metadata?: { fileHash?: string; uploadBatchId?: string }) {
    if (isMockMode) {
      return {
        path: `mock/${vendedorId}/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    const safeName = sanitizeStorageFileName(file.name);
    const path = `${vendedorId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    return uploadMediaFile(path, file, metadata);
  },

  async uploadProductThumbnail(vendedorId: string, file: File, metadata?: { fileHash?: string; uploadBatchId?: string }) {
    if (isMockMode) {
      return {
        path: `mock/${vendedorId}/thumbs/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    const safeName = sanitizeStorageFileName(file.name);
    const path = `${vendedorId}/thumbs/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    return uploadMediaFile(path, file, metadata);
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

    const ownerFilter = user.email
      ? `or=${encodeURIComponent(`(userId.eq.${user.uid},buyerEmail.eq.${user.email.toLowerCase()})`)}`
      : `userId=eq.${encodeURIComponent(user.uid)}`;
    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    const orders = await supabaseRest.get<SupabaseRow<Order>[]>(`/rest/v1/orders?${params.toString()}&${ownerFilter}`, true);
    const ownOrders = orders.filter((order) => (
      order.userId === user.uid ||
      (user.email && order.buyerEmail?.toLowerCase() === user.email.toLowerCase())
    ));
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

    const accessToken = await getCurrentAccessToken();
    if (!accessToken) throw new Error('Sessao admin expirada.');

    const response = await fetch('/api/admin/orders/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId: id, status }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(payload?.error || payload?.message || `Erro HTTP ${response.status}`);
    const updated = payload?.order as Order | undefined;
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
      return supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return loadLocalEvents().filter((event) => event.status === 'scheduled' || event.status === 'active');
      }
      throw error;
    }
  },

  async getPublishedEvents(count = 300): Promise<Event[]> {
    if (isMockMode) {
      return [];
    }

    const params = new URLSearchParams({
      select: '*',
      order: 'date.asc,createdAt.desc',
      limit: String(count),
    });
    try {
      const events = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`);
      return sortEvents(events.filter((event) => event.isPublished !== false)).slice(0, count);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return sortEvents(loadLocalEvents().filter((event) => event.isPublished !== false)).slice(0, count);
      }
      throw error;
    }
  },

  async getEventBySlug(slug: string): Promise<Event | null> {
    if (isMockMode) {
      return loadLocalEvents().find((event) => event.slug === slug && event.isPublished !== false) ?? null;
    }

    const params = new URLSearchParams({
      select: '*',
      slug: `eq.${slug}`,
      limit: '1',
    });
    const rows = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`);
    return rows.find((event) => event.isPublished !== false) ?? null;
  },

  async getPhotographerEvents(photographerId: string, count = 200): Promise<Event[]> {
    if (isMockMode) {
      return loadLocalEvents()
        .filter((event) => !event.photographerId || event.photographerId === photographerId)
        .slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      photographerId: `eq.${photographerId}`,
      order: 'date.asc,createdAt.desc',
      limit: String(count),
    });
    try {
      const events = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`, true);
      return sortEvents(events).slice(0, count);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return loadLocalEvents()
          .filter((event) => !event.photographerId || event.photographerId === photographerId)
          .slice(0, count);
      }
      throw error;
    }
  },

  async getPublishedPhotographerEvents(photographerId: string, count = 200): Promise<Event[]> {
    if (isMockMode) {
      return sortEventsNewestFirst(loadLocalEvents()
        .filter((event) => (!event.photographerId || event.photographerId === photographerId) && event.isPublished !== false))
        .slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      photographerId: `eq.${photographerId}`,
      isPublished: 'eq.true',
      order: 'date.desc,createdAt.desc',
      limit: String(count),
    });
    try {
      const events = await supabaseRest.get<SupabaseRow<Event>[]>(`/rest/v1/events?${params.toString()}`);
      return sortEventsNewestFirst(events.filter((event) => event.isPublished !== false)).slice(0, count);
    } catch (error) {
      if (isMissingEventsTableError(error)) {
        return [];
      }
      throw error;
    }
  },

  async createEvent(input: Pick<Event, 'name' | 'date' | 'location' | 'checkpoint' | 'status'> & Partial<Pick<Event, 'photographerId' | 'description' | 'coverImage' | 'coverMediaId' | 'bannerImage' | 'isPublished'>>): Promise<Event> {
    if (isMockMode) {
      const created = {
        id: `mock-event-${crypto.randomUUID()}`,
        slug: createEventSlug(input.name, input.date),
        ...input,
        isPublished: input.isPublished ?? true,
        createdAt: new Date().toISOString(),
      };
      saveLocalEvents([created, ...loadLocalEvents()]);
      return created;
    }

    const slug = await createAvailableEventSlug(input.name, input.date);
    const payload = {
      ...input,
      slug,
      isPublished: input.isPublished ?? true,
      createdAt: new Date().toISOString(),
    };

    try {
      let createdRows: SupabaseRow<Event>[];
      try {
        createdRows = await supabaseRest.post<SupabaseRow<Event>[]>(
          `/rest/v1/events?${selectAll}`,
          payload,
          true,
        );
      } catch (error) {
        if (!isMissingEventCoverMediaColumnError(error)) throw error;
        console.warn('Coluna events.coverMediaId ausente no cache do Supabase; salvando evento sem vinculo de midia da capa.');
        const { coverMediaId: _coverMediaId, ...fallbackPayload } = payload;
        createdRows = await supabaseRest.post<SupabaseRow<Event>[]>(
          `/rest/v1/events?${selectAll}`,
          fallbackPayload,
          true,
        );
      }
      const [created] = createdRows;

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
      if (isDuplicateSlugError(error)) {
        throw new Error('Ja existe um evento com este nome e data. Tente salvar novamente ou ajuste o nome do evento.');
      }
      throw error;
    }
  },

  async uploadEventCover(photographerId: string, file: File) {
    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(String(file.type || '').toLowerCase())) {
      throw new Error('Formato invalido para capa do evento. Envie JPG, PNG ou WEBP.');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Capa do evento muito grande. O limite e 15 MB.');
    }

    if (isMockMode) {
      return {
        path: `mock/event-covers/${photographerId}/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    const extension = file.type === 'image/webp' ? 'webp' : 'jpg';
    const safeName = sanitizeStorageFileName(file.name.replace(/\.[^.]+$/, `.${extension}`));
    const path = `covers/${photographerId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    return uploadSupabaseStorageObject('event-covers', path, file);
  },

  async updateEvent(id: string, input: Partial<Pick<Event, 'name' | 'date' | 'location' | 'checkpoint' | 'status' | 'description' | 'coverImage' | 'coverMediaId' | 'bannerImage' | 'isPublished' | 'isFeatured' | 'moderationStatus'>>): Promise<Event> {
    if (isMockMode) {
      const events = loadLocalEvents();
      const existing = events.find((event) => event.id === id);
      if (!existing) throw new Error('Evento nao encontrado.');
      const updated = {
        ...existing,
        ...input,
        slug: input.name || input.date ? createEventSlug(input.name ?? existing.name, input.date ?? existing.date) : existing.slug,
        updatedAt: new Date().toISOString(),
      };
      saveLocalEvents(events.map((event) => (event.id === id ? updated : event)));
      return updated;
    }

    const currentParams = new URLSearchParams({
      select: 'id,name,date,slug',
      id: `eq.${id}`,
      limit: '1',
    });
    const [existing] = await supabaseRest.get<SupabaseRow<Event>[]>(
      `/rest/v1/events?${currentParams.toString()}`,
      true,
    );
    if (!existing) throw new Error('Evento nao encontrado.');

    const payload = {
      ...input,
      slug: input.name || input.date
        ? await createAvailableEventSlug(input.name ?? existing.name, input.date ?? existing.date, id)
        : existing.slug,
    };
    const params = new URLSearchParams({ id: `eq.${id}` });
    let updatedRows: SupabaseRow<Event>[];
    try {
      updatedRows = await supabaseRest.patch<SupabaseRow<Event>[]>(
        `/rest/v1/events?${params.toString()}&${selectAll}`,
        payload,
        true,
      );
    } catch (error) {
      if (!isMissingEventCoverMediaColumnError(error)) throw error;
      console.warn('Coluna events.coverMediaId ausente no cache do Supabase; salvando evento sem alterar vinculo de midia da capa.');
      const { coverMediaId: _coverMediaId, ...fallbackPayload } = payload;
      updatedRows = await supabaseRest.patch<SupabaseRow<Event>[]>(
        `/rest/v1/events?${params.toString()}&${selectAll}`,
        fallbackPayload,
        true,
      );
    }
    const [updated] = updatedRows;

    if (!updated) throw new Error('Evento nao encontrado.');
    return updated;
  },

  async removeEvent(id: string): Promise<void> {
    if (isMockMode) {
      saveLocalEvents(loadLocalEvents().filter((event) => event.id !== id));
      return;
    }

    await supabaseFetchNoContent(
      `/rest/v1/events?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
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

export type CheckoutPaymentMethod = 'pix' | 'credit_card' | 'checkout';

export interface CreateCheckoutInput {
  userId: string;
  buyer: Buyer;
  items: { id: string }[];
  successUrl: string;
  cancelUrl?: string;
  paymentMethod?: CheckoutPaymentMethod;
  couponCode?: string;
}

export interface CreateCheckoutResult {
  paymentUrl: string;
  orderId: string;
  total: number;
  subtotal: number;
  discountTotal: number;
  paymentMethod: CheckoutPaymentMethod;
  provider: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';
  pix?: { qrCode?: string; qrCodeImage?: string; expiresAt?: string } | null;
  requestId?: string;
}

function createCheckoutClientError(input: { response: Response; data: any; raw: string }) {
  const detail = String(input.data?.error || input.data?.message || input.data?.msg || input.raw || '').trim();
  const requestId = input.data?.requestId ? ` Codigo: ${input.data.requestId}.` : '';
  const isPlatformCrash = /FUNCTION_INVOCATION_FAILED|A server error has occurred|Internal Server Error/i.test(detail);

  if (isPlatformCrash) {
    return new Error(`Nao foi possivel iniciar o pagamento. Tente novamente em alguns minutos.${requestId}`);
  }

  if (detail) {
    return new Error(`Nao foi possivel iniciar o pagamento: ${detail}${requestId}`);
  }

  return new Error(`Nao foi possivel iniciar o pagamento. HTTP ${input.response.status}.${requestId}`);
}

export const paymentService = {
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
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
      throw createCheckoutClientError({ response, data, raw });
    }

    return {
      paymentUrl: data.paymentUrl || data.url,
      orderId: data.orderId,
      total: Number(data.total || 0),
      subtotal: Number(data.subtotal ?? data.total ?? 0),
      discountTotal: Number(data.discountTotal || 0),
      paymentMethod: data.paymentMethod || input.paymentMethod || 'checkout',
      provider: data.provider || 'infinitepay',
      status: data.status || 'pending',
      pix: data.pix || null,
      requestId: data.requestId || undefined,
    };
  },

  async createInfinitePayCheckout(input: CreateCheckoutInput) {
    return this.createCheckout({ ...input, paymentMethod: input.paymentMethod || 'checkout' });
  },
};

export const customerAccountService = {
  async upsertCustomerProfile(input: { name: string; avatarUrl?: string | null }) {
    const user = getCurrentUser();
    if (!user?.id || !user.email) throw new Error('Entre novamente para atualizar sua conta.');

    const [profile] = await supabaseRest.post<Customer[]>(
      '/rest/v1/customers?on_conflict=id',
      {
        id: user.id,
        email: user.email,
        name: input.name.trim(),
        avatarUrl: input.avatarUrl || null,
      },
      true,
    );

    return profile;
  },

  async getFavorites(): Promise<Product[]> {
    const user = getCurrentUser();
    if (!user?.id) return [];

    const rows = await supabaseRest.get<Array<{ products: Product | null }>>(
      `/rest/v1/customer_favorites?select=products(*)&userId=eq.${encodeURIComponent(user.id)}&order=createdAt.desc`,
      true,
    ).catch(() => []);

    const products = rows.map((row) => row.products).filter(Boolean) as Product[];
    return signMediaUrls(products, { protectImageOriginals: true });
  },

  async setFavorite(product: Product, isFavorite: boolean) {
    const user = getCurrentUser();
    if (!user?.id || !user.email) return;

    if (isFavorite) {
      await supabaseRest.post('/rest/v1/customer_favorites?on_conflict=userId,photoId', {
        userId: user.id,
        customerEmail: user.email,
        photoId: product.id,
      }, true);
      return;
    }

    await supabaseFetchNoContent(
      `/rest/v1/customer_favorites?userId=eq.${encodeURIComponent(user.id)}&photoId=eq.${encodeURIComponent(product.id)}`,
      { method: 'DELETE' },
    );
  },
};

async function supabaseFetchNoContent(path: string, init: RequestInit) {
  const accessToken = await getCurrentAccessToken();
  if (!accessToken) throw new Error('Sessao expirada. Entre novamente.');
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
}

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

    type PhotographerTransactionRow = {
      id: string;
      photographerId: string;
      orderId: string | null;
      orderItemId: string | null;
      grossAmount: number;
      platformFee: number;
      netAmount: number;
      status: 'pending' | 'available' | 'paid' | 'cancelled';
      createdAt: string;
    };

    async function getReservedWithdrawalAmount() {
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
      return reservedWithdrawals.reduce((total, withdrawal) => (
        total + Number(withdrawal.amount || 0)
      ), 0);
    }

    const downloadParams = new URLSearchParams({
      select: 'id,productId',
      vendedorId: `eq.${vendedorId}`,
      limit: '10000',
    });
    const downloadEvents = await supabaseRest.get<{ id: string; productId: string }[]>(
      `/rest/v1/download_events?${downloadParams.toString()}`,
      true,
    ).catch(() => []);
    const downloadsByProductId = new Map<string, number>();
    for (const event of downloadEvents) {
      downloadsByProductId.set(event.productId, (downloadsByProductId.get(event.productId) ?? 0) + 1);
    }

    try {
      const transactionParams = new URLSearchParams({
        select: 'id,photographerId,orderId,orderItemId,grossAmount,platformFee,netAmount,status,createdAt',
        photographerId: `eq.${vendedorId}`,
        status: 'in.(pending,available,paid)',
        order: 'createdAt.desc',
        limit: '1000',
      });
      const transactions = await supabaseRest.get<PhotographerTransactionRow[]>(
        `/rest/v1/photographer_transactions?${transactionParams.toString()}`,
        true,
      );

      if (transactions.length > 0) {
        const orderItemIds = Array.from(new Set(transactions.map((transaction) => transaction.orderItemId).filter(Boolean))) as string[];
        const orderItems = orderItemIds.length > 0
          ? await supabaseRest.get<SupabaseRow<OrderItem>[]>(
            `/rest/v1/order_items?select=*&id=${postgrestIn(orderItemIds)}&limit=1000`,
            true,
          ).catch(() => [])
          : [];
        const signedOrderItems = await signMediaUrls(orderItems);
        const orderItemById = new Map(signedOrderItems.map((item) => [item.id, item]));
        const productById = new Map(products.map((product) => [product.id, product]));

        const sales = transactions
          .filter((transaction) => transaction.status !== 'cancelled')
          .map((transaction): PhotographerSale => {
            const item = transaction.orderItemId ? orderItemById.get(transaction.orderItemId) : undefined;
            const product = item?.productId ? productById.get(item.productId) : undefined;
            return {
              id: item?.id ?? transaction.orderItemId ?? transaction.id,
              orderId: transaction.orderId ?? '',
              productId: item?.productId ?? product?.id ?? '',
              name: item?.name ?? product?.name ?? 'Midia vendida',
              type: item?.type ?? product?.type ?? 'IMG',
              price: Number(transaction.grossAmount || item?.price || product?.price || 0),
              url: item?.url ?? product?.url ?? '',
              vendedorId,
              bib: item?.bib ?? product?.bib ?? '',
              event: item?.event ?? product?.event ?? '',
              checkpoint: item?.checkpoint ?? product?.checkpoint ?? '',
              thumbnailUrl: item?.thumbnailUrl ?? product?.thumbnailUrl ?? null,
              createdAt: item?.createdAt ?? transaction.createdAt,
              orderCreatedAt: transaction.createdAt,
              orderStatus: 'paid',
              netAmount: Number(transaction.netAmount || 0),
            } satisfies PhotographerSale;
          })
          .sort((a, b) => new Date(b.orderCreatedAt).getTime() - new Date(a.orderCreatedAt).getTime());

        const releaseWindowMs = 7 * 24 * 60 * 60 * 1000;
        const totalEarnings = sales.reduce((total, sale) => total + Number(sale.netAmount || 0), 0);
        const pendingEarnings = transactions
          .filter((transaction) => transaction.status === 'pending' && Date.now() - new Date(transaction.createdAt).getTime() < releaseWindowMs)
          .reduce((total, transaction) => total + Number(transaction.netAmount || 0), 0);
        const currentMonthKey = new Date().toISOString().slice(0, 7);
        const monthlyEarnings = sales
          .filter((sale) => sale.orderCreatedAt.slice(0, 7) === currentMonthKey)
          .reduce((total, sale) => total + Number(sale.netAmount || 0), 0);
        const reservedWithdrawalAmount = await getReservedWithdrawalAmount();
        const availableBalance = Math.max(0, totalEarnings - pendingEarnings - reservedWithdrawalAmount);

        const performanceByProductId = new Map<string, PhotographerProductPerformance>();
        for (const sale of sales) {
          if (!sale.productId) continue;
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

        const todayKey = new Date().toISOString().slice(0, 10);
        return {
          metrics: {
            totalEarnings,
            pendingEarnings,
            salesCount: sales.length,
            todaySalesCount: sales.filter((sale) => sale.orderCreatedAt.slice(0, 10) === todayKey).length,
            publishedMediaCount: publishedProducts.length,
            photoCount: publishedProducts.filter((product) => product.type === 'IMG').length,
            videoCount: publishedProducts.filter((product) => product.type === 'VIDEO' || product.type === 'VIEW').length,
            rating: 5,
            downloads: downloadEvents.length,
            platformFeePercent: feePercent,
            monthlyEarnings,
            availableBalance,
            monthlyGoal: 5000,
          },
          recentSales: sales,
          productPerformance: Array.from(performanceByProductId.values())
            .sort((a, b) => b.netRevenue - a.netRevenue || b.downloads - a.downloads)
            .slice(0, 8),
        };
      }
    } catch (error) {
      console.warn('Transacoes do fotografo indisponiveis; usando fallback por pedidos.', error);
    }

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
    // Photographers can fetch their own sales via order_items, but orders are row-level secured too.
    // The database policy must allow a vendor to read orders linked to their own order_items.
    const orderParams = new URLSearchParams({
      select: 'id,status,createdAt,updatedAt',
      id: postgrestIn(orderIds),
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
    const reservedWithdrawalAmount = await getReservedWithdrawalAmount();
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
        supportEmail: FUNPACE_CONTACT_EMAIL,
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
    return {
      ...settings,
      supportEmail: settings.supportEmail || FUNPACE_CONTACT_EMAIL,
    };
  },

  async updateSettings(settings: Partial<Pick<PlatformSettings, 'platformFeePercent' | 'withdrawalFee' | 'autoBlockSuspicious' | 'paymentProvider' | 'brandName' | 'supportEmail' | 'maxUploadBytes'>>): Promise<PlatformSettings> {
    if (isMockMode) {
      return {
        id: 'default',
        platformFeePercent: settings.platformFeePercent ?? 30,
        withdrawalFee: settings.withdrawalFee ?? 5,
        autoBlockSuspicious: settings.autoBlockSuspicious ?? true,
        paymentProvider: settings.paymentProvider,
        brandName: settings.brandName,
        supportEmail: settings.supportEmail,
        maxUploadBytes: settings.maxUploadBytes,
      };
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
      const params = new URLSearchParams({
        select: 'platformFeePercent',
        id: 'eq.default',
        limit: '1',
      });
      const [settings] = await supabaseRest.get<Pick<PlatformSettings, 'platformFeePercent'>[]>(
        `/rest/v1/platform_settings?${params.toString()}`,
      );
      return { platformFeePercent: Number(settings?.platformFeePercent ?? 30) };
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
  async getPublicPhotographers(count = 1000): Promise<Photographer[]> {
    if (isMockMode) {
      return mockPhotographers
        .filter((photographer) => photographer.verified && photographer.isPublic !== false)
        .slice(0, count);
    }

    const params = new URLSearchParams({
      select: '*',
      verified: 'eq.true',
      isPublic: 'eq.true',
      order: 'createdAt.desc',
    });
    return getPagedRows<SupabaseRow<Photographer>>(`/rest/v1/photographers?${params.toString()}`, count);
  },

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
    if (rows[0]) return rows[0];

    const normalizedId = normalizePhotographerUsername(id);
    const fallbackParams = new URLSearchParams({
      select: '*',
      verified: 'eq.true',
      limit: '1000',
    });
    const publicRows = await supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${fallbackParams.toString()}`);
    return publicRows.find((photographer) =>
      createPhotographerSlug(photographer.username || photographer.slug || photographer.displayName || photographer.name) === normalizedId
    ) ?? null;
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

  async getPublicPhotographerBySlug(slug: string): Promise<Photographer | null> {
    const normalizedSlug = normalizePhotographerUsername(slug.replace(/^@/, ''));
    if (isMockMode) {
      return mockPhotographers.find((photographer) =>
        photographer.isPublic !== false &&
        createPhotographerSlug(photographer.username || photographer.slug || photographer.displayName || photographer.name) === normalizedSlug
      ) ?? null;
    }

    const params = new URLSearchParams({
      select: '*',
      or: `(username.eq.${normalizedSlug},slug.eq.${normalizedSlug})`,
      isPublic: 'eq.true',
      limit: '1',
    });
    const rows = await supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${params.toString()}`);
    if (rows[0]) return rows[0];

    const fallbackParams = new URLSearchParams({
      select: '*',
      verified: 'eq.true',
      isPublic: 'eq.true',
      limit: '1000',
    });
    const publicRows = await supabaseRest.get<SupabaseRow<Photographer>[]>(`/rest/v1/photographers?${fallbackParams.toString()}`);
    return publicRows.find((photographer) =>
      createPhotographerSlug(photographer.displayName || photographer.name) === normalizedSlug
    ) ?? null;
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
    changes: Partial<Pick<Photographer, 'name' | 'username' | 'isPublic' | 'displayName' | 'bio' | 'avatar' | 'profilePhoto' | 'coverPhoto' | 'phone' | 'instagram' | 'city' | 'cpf' | 'verified' | 'commissionPercent' | 'blockedAt'>>,
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

  async updateOwnPublicProfile(
    id: string,
    changes: Partial<Pick<Photographer, 'name' | 'username' | 'isPublic' | 'displayName' | 'bio' | 'avatar' | 'profilePhoto' | 'coverPhoto' | 'instagram' | 'city'>>,
  ): Promise<Photographer> {
    const nextUsername = validatePhotographerUsername(changes.username || changes.displayName || changes.name || '');
    const payload = {
      ...changes,
      username: nextUsername,
      slug: nextUsername,
      isPublic: changes.isPublic ?? true,
    };

    if (isMockMode) {
      const existing = mockPhotographers.find((photographer) => photographer.id === id);
      if (!existing) throw new Error('Fotografo nao encontrado.');
      const updated = { ...existing, ...payload } as Photographer;
      mockPhotographers = mockPhotographers.map((photographer) => (photographer.id === id ? updated : photographer));
      return updated;
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Photographer>[]>(
      `/rest/v1/photographers?${params.toString()}&${selectAll}`,
      payload,
      true,
    );

    if (!updated) throw new Error('Fotografo nao encontrado.');
    return updated;
  },

  async uploadProfilePhoto(photographerId: string, file: File) {
    if (isMockMode) {
      return {
        path: `mock/avatars/${photographerId}/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    return uploadPhotographerProfileImage('avatar', file);
  },

  async uploadCoverPhoto(photographerId: string, file: File) {
    if (isMockMode) {
      return {
        path: `mock/covers/${photographerId}/${file.name}`,
        publicUrl: URL.createObjectURL(file),
      };
    }

    return uploadPhotographerProfileImage('cover', file);
  },
};

export const adminService = {
  async getSnapshot(): Promise<{
    photographers: Photographer[];
    products: Product[];
    orders: Order[];
    withdrawals: WithdrawalRequest[];
    customers: Customer[];
    payments: PaymentRecord[];
    paymentEvents: PaymentEventLog[];
    coupons: Coupon[];
    adminLogs: AdminActivityLog[];
    platformSettings: Pick<PlatformSettings, 'platformFeePercent'>;
  }> {
    if (isMockMode) {
      return {
        photographers: mockPhotographers,
        products: mockProducts,
        orders: [],
        withdrawals: [],
        customers: [],
        payments: [],
        paymentEvents: [],
        coupons: [],
        adminLogs: [],
        platformSettings: { platformFeePercent: 30 },
      };
    }

    const accessToken = await getCurrentAccessToken();
    if (!accessToken) throw new Error('Sessao admin ausente.');

    const response = await fetch('/api/admin/snapshot', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!response.ok) {
      throw new Error(data?.error || data?.message || raw || `Snapshot admin HTTP ${response.status}`);
    }

    return {
      photographers: data.photographers || [],
      products: await signMediaUrls(data.products || []),
      orders: data.orders || [],
      withdrawals: data.withdrawals || [],
      customers: data.customers || [],
      payments: data.payments || [],
      paymentEvents: data.paymentEvents || [],
      coupons: data.coupons || [],
      adminLogs: data.adminLogs || [],
      platformSettings: data.platformSettings || { platformFeePercent: 30 },
    };
  },

  async getCustomers(count = 500): Promise<Customer[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<Customer>[]>(`/rest/v1/customers?${params.toString()}`, true);
  },

  async getPayments(count = 500): Promise<PaymentRecord[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<PaymentRecord>[]>(`/rest/v1/payments?${params.toString()}`, true);
  },

  async getPaymentEvents(count = 500): Promise<PaymentEventLog[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<PaymentEventLog>[]>(`/rest/v1/payment_events?${params.toString()}`, true);
  },

  async getPaymentRecoveryIssues(): Promise<{ issues: PaymentRecoveryIssue[]; summary: Record<string, number> }> {
    if (isMockMode) return { issues: [], summary: {} };

    const accessToken = await getCurrentAccessToken();
    if (!accessToken) throw new Error('Sessao admin expirada.');

    const response = await fetch('/api/admin/payments/recovery', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || `Erro HTTP ${response.status}`);
    return {
      issues: payload.issues || [],
      summary: payload.summary || {},
    };
  },

  async recoverPayment(input: { orderId: string; action: 'reprocess' | 'manual_release' | 'fulfill'; reason?: string }) {
    if (isMockMode) throw new Error('Recuperacao de pagamento esta disponivel apenas no modo producao.');

    const accessToken = await getCurrentAccessToken();
    if (!accessToken) throw new Error('Sessao admin expirada.');

    const response = await fetch('/api/admin/payments/recovery', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || `Erro HTTP ${response.status}`);
    return payload as { orderId: string; status: Order['status'] };
  },

  async getCoupons(count = 200): Promise<Coupon[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<Coupon>[]>(`/rest/v1/coupons?${params.toString()}`, true);
  },

  async createCoupon(input: Pick<Coupon, 'code' | 'type' | 'value' | 'maxUses' | 'startsAt' | 'expiresAt' | 'isActive'>): Promise<Coupon> {
    if (isMockMode) {
      return {
        id: `mock-coupon-${crypto.randomUUID()}`,
        ...input,
        usedCount: 0,
        createdAt: new Date().toISOString(),
      };
    }

    const [created] = await supabaseRest.post<SupabaseRow<Coupon>[]>(
      `/rest/v1/coupons?${selectAll}`,
      {
        ...input,
        code: input.code.trim().toUpperCase(),
        createdAt: new Date().toISOString(),
      },
      true,
    );

    if (!created) throw new Error('Nao foi possivel criar o cupom.');
    return created;
  },

  async updateCoupon(id: string, changes: Partial<Pick<Coupon, 'code' | 'type' | 'value' | 'maxUses' | 'startsAt' | 'expiresAt' | 'isActive'>>): Promise<Coupon> {
    if (isMockMode) {
      throw new Error('Atualizacao de cupom esta disponivel apenas no modo producao.');
    }

    const params = new URLSearchParams({ id: `eq.${id}` });
    const [updated] = await supabaseRest.patch<SupabaseRow<Coupon>[]>(
      `/rest/v1/coupons?${params.toString()}&${selectAll}`,
      'code' in changes && changes.code ? { ...changes, code: changes.code.trim().toUpperCase() } : changes,
      true,
    );

    if (!updated) throw new Error('Cupom nao encontrado.');
    return updated;
  },

  async getAdminLogs(count = 500): Promise<AdminActivityLog[]> {
    if (isMockMode) return [];

    const params = new URLSearchParams({
      select: '*',
      order: 'createdAt.desc',
      limit: String(count),
    });
    return supabaseRest.get<SupabaseRow<AdminActivityLog>[]>(`/rest/v1/admin_activity_logs?${params.toString()}`, true);
  },

  async logAction(input: Pick<AdminActivityLog, 'action' | 'targetType' | 'targetId' | 'metadata'>): Promise<void> {
    if (isMockMode) return;

    const user = getCurrentUser();
    await supabaseRest.post('/rest/v1/admin_activity_logs', {
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    }, true).catch((error) => {
      console.error('Nao foi possivel registrar log admin:', error);
    });
  },
};
