export interface Photographer {
  id: string;
  auth_user_id?: string | null;
  slug?: string | null;
  username?: string | null;
  isPublic?: boolean | null;
  name: string;
  displayName?: string | null;
  email: string;
  bio: string;
  avatar: string;
  profilePhoto?: string | null;
  coverPhoto?: string | null;
  phone?: string;
  instagram?: string;
  city?: string | null;
  cpf?: string;
  verified: boolean;
  approved?: boolean;
  status?: 'pending' | 'active' | 'disabled';
  role?: 'photographer';
  commissionPercent?: number | null;
  referralCode?: string | null;
  referredByPhotographerId?: string | null;
  referral_id?: string | null;
  invited_by?: string | null;
  blockedAt?: string | null;
  lastLoginAt?: string | null;
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

export type ReferralStatus = 'pending' | 'approved' | 'active' | 'rewarded' | 'canceled';
export type ReferralRewardStatus = 'none' | 'pending' | 'available' | 'paid' | 'canceled';
export type ReferralRewardRuleType = 'approval_fixed' | 'first_sale_fixed' | 'recurring_commission';

export interface PhotographerReferral {
  id: string;
  referrerPhotographerId: string;
  referredPhotographerId: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: string;
  approvedAt?: string | null;
  firstSaleAt?: string | null;
  rewardAmount: number;
  rewardStatus: ReferralRewardStatus;
  paidAt?: string | null;
  canceledAt?: string | null;
  audit?: Record<string, unknown> | null;
}

export interface ReferralSettings {
  enabled: boolean;
  rewardRuleType: ReferralRewardRuleType;
  approvalRewardAmount: number;
  firstSaleRewardAmount: number;
  recurringCommissionPercent: number;
  recurringCommissionMonths: number;
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
  watermarkUrl?: string | null;
  duration?: string;
  storagePath?: string;
  fileHash?: string | null;
  fileSize?: number | null;
  originalFileName?: string | null;
  thumbnailHash?: string | null;
  uploadBatchId?: string | null;
  eventId?: string | null;
  faceIndexStatus?: 'pending' | 'processing' | 'indexed' | 'no_face' | 'failed' | 'disabled';
  faceIndexError?: string | null;
  faceIndexedAt?: string | null;
  faceIndexAttempts?: number;
  faceIndexErrorCode?: string | null;
  faceProcessingStartedAt?: string | null;
  faceProcessedAt?: string | null;
  faceIndexRunId?: string | null;
  status?: 'draft' | 'pending' | 'processing' | 'published' | 'sold' | 'hidden' | 'removed';
  createdAt?: string;
  favoriteCount?: number;
  viewCount?: number;
  salesCount?: number;
}

export interface FaceSearchMatch {
  product: Product;
  similarity: number;
}

export interface FaceSearchResponse {
  matches: FaceSearchMatch[];
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
  avatarUrl?: string | null;
  preferences?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Event {
  id: string;
  photographerId?: string | null;
  name: string;
  slug?: string | null;
  description?: string | null;
  date: string;
  location?: string | null;
  checkpoint?: string | null;
  coverImage?: string | null;
  coverMediaId?: string | null;
  bannerImage?: string | null;
  cover_position?: string | null;
  isPublished?: boolean;
  isFeatured?: boolean;
  moderationStatus?: 'pending' | 'approved' | 'rejected';
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
  subtotal?: number | null;
  discountTotal?: number | null;
  discountType?: 'bulk_photo_quantity' | 'coupon' | null;
  discountPercentage?: number | null;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'canceled' | 'refused' | 'refunded';
  paymentMethod?: 'pix' | 'credit_card' | 'checkout';
  paymentProvider: string;
  paymentExternalId?: string | null;
  checkoutUrl?: string | null;
  paidEmailSentAt?: string | null;
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
  paymentProvider?: string;
  brandName?: string;
  supportEmail?: string;
  maxUploadBytes?: number;
  referralSettings?: ReferralSettings | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string;
  method: 'pix' | 'credit_card' | 'checkout';
  status: Order['status'];
  rawResponse?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentEventLog {
  id: string;
  provider: string;
  eventId: string;
  orderId?: string | null;
  status?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentRecoveryIssue {
  orderId: string;
  status: Order['status'];
  buyerName: string;
  buyerEmail: string;
  total: number;
  paymentMethod?: Order['paymentMethod'];
  paymentProvider: string;
  paymentExternalId?: string | null;
  createdAt: string;
  itemCount: number;
  accessCount: number;
  missingAccessCount: number;
  paymentStatuses: string[];
  eventStatuses: string[];
  hasTransactionNsu: boolean;
  hasSlug: boolean;
  reasons: string[];
}

export interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxUses?: number | null;
  usedCount: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminActivityLog {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
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

export interface PhotographerWallet {
  id: string;
  photographerId: string;
  balance: number;
  pendingBalance: number;
  updatedAt?: string;
}

export interface PhotographerTransaction {
  id: string;
  photographerId: string;
  orderId?: string | null;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
  status: 'pending' | 'available' | 'paid' | 'cancelled';
  createdAt: string;
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
