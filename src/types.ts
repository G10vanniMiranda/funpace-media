export interface Photographer {
  id: string;
  name: string;
  email: string;
  bio: string;
  avatar: string;
  phone?: string;
  cpf?: string;
  verified: boolean;
  createdAt?: string;
  stats: {
    photos: number;
    events: number;
    rating: number;
    totalEarnings: number;
    pendingEarnings: number;
    salesCount: number;
  };
}

export type ProductType = 'IMG' | 'VIEW' | 'VIDEO';

export interface Product {
  id: string;
  name: string;
  price: number;
  url: string;
  type: ProductType;
  vendedorId: string;
  bib: string;
  event: string;
  checkpoint: string;
  thumbnailUrl?: string;
  duration?: string;
  storagePath?: string;
  status?: 'draft' | 'published' | 'removed';
  createdAt?: string;
}

export interface Buyer {
  fullName: string;
  email: string;
  phone: string;
  cpf?: string;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  cpf?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Event {
  id: string;
  name: string;
  date: string;
  location?: string | null;
  checkpoint?: string | null;
  status: 'scheduled' | 'active' | 'closed';
  createdAt?: string;
  updatedAt?: string;
}

export interface Order {
  id: string;
  userId?: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerCpf: string;
  total: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  paymentProvider: string;
  paymentExternalId?: string | null;
  checkoutUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  type: ProductType;
  price: number;
  url: string;
  vendedorId: string;
  bib: string;
  event: string;
  checkpoint: string;
  thumbnailUrl?: string | null;
  createdAt: string;
}

export interface AdminMetrics {
  grossRevenue: number;
  platformFee: number;
  paidOrders: number;
  pendingOrders: number;
  totalOrders: number;
  totalProducts: number;
  publishedProducts: number;
  removedProducts: number;
  photoCount: number;
  videoCount: number;
}

export interface PlatformSettings {
  id: 'default';
  platformFeePercent: number;
  withdrawalFee: number;
  autoBlockSuspicious: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WithdrawalRequest {
  id: string;
  photographerId: string;
  amount: number;
  pixKey: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
  processedAt?: string | null;
}

export interface PhotographerSale {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  type: ProductType;
  price: number;
  url: string;
  vendedorId: string;
  bib: string;
  event: string;
  checkpoint: string;
  thumbnailUrl?: string | null;
  createdAt: string;
  orderCreatedAt: string;
  orderStatus: Order['status'];
  netAmount: number;
}

export interface PhotographerDashboardMetrics {
  totalEarnings: number;
  pendingEarnings: number;
  salesCount: number;
  todaySalesCount: number;
  publishedMediaCount: number;
  photoCount: number;
  videoCount: number;
  rating: number;
  downloads: number;
  platformFeePercent: number;
  monthlyEarnings: number;
  availableBalance: number;
  monthlyGoal: number;
}

export interface PhotographerProductPerformance {
  productId: string;
  name: string;
  type: ProductType;
  event: string;
  bib: string;
  thumbnailUrl?: string | null;
  salesCount: number;
  downloads: number;
  grossRevenue: number;
  netRevenue: number;
}

export interface Photo extends Product {
  type: 'IMG';
}

export interface Video extends Product {
  type: 'VIDEO';
  thumbnailUrl?: string;
  duration?: string;
}
