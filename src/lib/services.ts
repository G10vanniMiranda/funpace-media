import { Product, Photographer, Order, OrderItem, PlatformSettings } from '../types';
import { MOCK_PHOTOGRAPHERS, MOCK_PHOTOS, MOCK_VIDEOS } from '../data';
import { isMockMode } from './config';
import { getCurrentUser, supabaseRest, supabaseStorage } from './supabase';

type SupabaseRow<T> = T & { id: string };

const selectAll = 'select=*';
const mediaBucket = 'funpace-media';
let mockProducts = [...MOCK_PHOTOS, ...MOCK_VIDEOS];
let mockPhotographers = [...MOCK_PHOTOGRAPHERS];

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

  return orders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) ?? [],
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
    return supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`);
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
    return supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
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
    return supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`);
  },

  async getVendedorProducts(vendedorId: string): Promise<Product[]> {
    if (isMockMode) {
      return mockProducts.filter((product) => product.vendedorId === vendedorId);
    }

    const params = new URLSearchParams({
      select: '*',
      vendedorId: `eq.${vendedorId}`,
    });
    return supabaseRest.get<SupabaseRow<Product>[]>(`/rest/v1/products?${params.toString()}`, true);
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
    return supabaseStorage.upload(mediaBucket, path, file);
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
    return supabaseStorage.upload(mediaBucket, path, file);
  },
};

export const orderService = {
  async getCustomerOrders(count = 50): Promise<Order[]> {
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
